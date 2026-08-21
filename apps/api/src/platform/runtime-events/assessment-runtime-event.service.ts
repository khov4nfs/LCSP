import {
  ASSESSMENT_RUNTIME_EVENT_TYPES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  ASSESSMENT_RUNTIME_STAGE_CODES,
  type AssessmentRuntimeEventType,
  type AssessmentRuntimeActiveTool,
  type AssessmentRuntimeActivityEvent,
  type AssessmentRuntimeRun,
  type AssessmentRuntimeRunStatus,
  type AssessmentRuntimeSnapshot,
  type AssessmentRuntimeStageCode,
  type AssessmentRuntimeSummaryValue,
} from "@lcsp/contracts/evidence";
import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";
import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";
import type { Prisma } from "@prisma/client";
import { Injectable, Logger } from "@nestjs/common";

import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import {
  FALLBACK_SUMMARY,
  sanitizeRuntimeSummaryText,
  sanitizeRuntimeSummaryValue,
  summarizeRuntimeError,
} from "./runtime-summary-sanitizer.js";

type RecordRuntimeEventInput = {
  organizationId: string;
  assessmentId: string;
  runId: string;
  correlationId: string;
  eventType: AssessmentRuntimeEventType;
  runStatus: AssessmentRuntimeRunStatus;
  stage: AssessmentRuntimeStageCode;
  toolName?: string | null;
  summary: string;
  inputSummary?: unknown;
  outputSummary?: unknown;
  errorSummary?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  durationMs?: number | null;
  attempt?: number | null;
  waitingReason?: string | null;
};

type EnsureRunInput = {
  organizationId: string;
  assessmentId: string;
  runId: string;
  correlationId: string;
  stage: AssessmentRuntimeStageCode;
  summary: string;
  startedAt?: Date | null;
  runStatus?: AssessmentRuntimeRunStatus;
};

export type RecordWorkerRuntimeEventInput = Omit<
  RecordRuntimeEventInput,
  "organizationId" | "assessmentId" | "runId" | "correlationId"
> & {
  scanJobId: string;
};

export type RecordWorkerRuntimeEventResult =
  { recorded: true } | { recorded: false; reason: "not_found" | "inactive" };

type PersistedAssessmentRuntimeEvent = {
  id: string;
  organizationId: string;
  assessmentId: string;
  runId: string;
  correlationId: string;
  sequence: number;
  eventType: string;
  runStatus: string;
  stage: string;
  toolName: string | null;
  summary: string;
  inputSummaryJson: Prisma.JsonValue | null;
  outputSummaryJson: Prisma.JsonValue | null;
  errorSummary: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
  attempt: number | null;
  waitingReason: string | null;
  createdAt: Date;
};

type RuntimeScanJobSnapshot = {
  id: string;
  assessmentId: string;
  snapshotId: string;
  status: string;
  attemptCount: number;
  blockedReason: string | null;
  updatedAt: Date;
};

type RuntimeEvidenceReportSnapshot = {
  id: string;
  assessmentId: string;
  scanJobId: string;
  snapshotId: string;
  status: string;
  rejectionReason: string | null;
  createdAt: Date;
};

/**
 * Persists privacy-safe assessment runtime events and builds workspace snapshots for live runtime observability.
 */
@Injectable()
export class AssessmentRuntimeEventService {
  private readonly logger = new Logger(AssessmentRuntimeEventService.name);

  /**
   * Creates the runtime-event service with access to Prisma persistence.
   *
   * @param prisma - Prisma service used to persist runtime events and query scan/evidence state.
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records the initial run-started event only when the run has no existing runtime events.
   *
   * @param input - Run identity, organization, assessment, stage, correlation, and summary metadata.
   * @returns A promise that resolves after the event is recorded or skipped because the run already exists.
   */
  async recordRunStartedIfMissing(input: EnsureRunInput): Promise<void> {
    const existing = (await this.safeFindFirst({
      where: { runId: input.runId },
      select: { id: true },
    })) as { id: string } | null;
    if (existing) {
      return;
    }

    await this.recordEvent({
      ...input,
      eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.runStarted,
      runStatus: input.runStatus ?? ASSESSMENT_RUNTIME_RUN_STATUSES.running,
      summary: sanitizeRuntimeSummaryText(input.summary),
      startedAt: input.startedAt ?? null,
    });
  }

  /**
   * Records a run-stage transition only when a prior event exists and its stage differs from the requested stage.
   *
   * @param input - Run identity and target stage metadata used to detect and persist the transition.
   * @returns A promise that resolves after the stage event is recorded or skipped when no change is needed.
   */
  async recordRunStageChangedIfNeeded(input: EnsureRunInput): Promise<void> {
    const latest = (await this.safeFindFirst({
      where: { runId: input.runId },
      orderBy: [{ sequence: "desc" }],
      select: { stage: true },
    })) as { stage: string } | null;
    if (!latest || latest.stage === input.stage) {
      return;
    }

    await this.recordEvent({
      ...input,
      eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.runStageChanged,
      runStatus: input.runStatus ?? ASSESSMENT_RUNTIME_RUN_STATUSES.running,
      summary: sanitizeRuntimeSummaryText(input.summary),
      startedAt: input.startedAt ?? null,
    });
  }

  /**
   * Records that an orchestration tool has started execution.
   *
   * @param input - Runtime event data excluding the event type and run status supplied by this method.
   * @returns A promise that resolves after the tool-started event is persisted.
   */
  async recordToolStarted(
    input: Omit<RecordRuntimeEventInput, "eventType" | "runStatus">,
  ): Promise<void> {
    await this.recordEvent({
      ...input,
      eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolStarted,
      runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
    });
  }

  /**
   * Records that an orchestration tool completed and the run is now waiting for its next step.
   *
   * @param input - Runtime event data excluding the event type and run status supplied by this method.
   * @returns A promise that resolves after the tool-completed event is persisted.
   */
  async recordToolCompleted(
    input: Omit<RecordRuntimeEventInput, "eventType" | "runStatus">,
  ): Promise<void> {
    await this.recordEvent({
      ...input,
      eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
      runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.waiting,
    });
  }

  /**
   * Records that a tool cannot continue until additional input becomes available.
   *
   * @param input - Runtime event data excluding the event type and run status supplied by this method.
   * @returns A promise that resolves after the waiting-input event is persisted.
   */
  async recordToolWaitingInput(
    input: Omit<RecordRuntimeEventInput, "eventType" | "runStatus">,
  ): Promise<void> {
    await this.recordEvent({
      ...input,
      eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolWaitingInput,
      runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.waiting,
    });
  }

  /**
   * Records a failed orchestration-tool execution and marks the runtime run as failed for the event.
   *
   * @param input - Runtime event data excluding the event type and run status supplied by this method.
   * @returns A promise that resolves after the tool-failed event is persisted.
   */
  async recordToolFailed(
    input: Omit<RecordRuntimeEventInput, "eventType" | "runStatus">,
  ): Promise<void> {
    await this.recordEvent({
      ...input,
      eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolFailed,
      runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.failed,
    });
  }

  /**
   * Records successful completion of an assessment runtime run.
   *
   * @param input - Runtime event data excluding the event type and run status supplied by this method.
   * @returns A promise that resolves after the run-completed event is persisted.
   */
  async recordRunCompleted(
    input: Omit<RecordRuntimeEventInput, "eventType" | "runStatus">,
  ): Promise<void> {
    await this.recordEvent({
      ...input,
      eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.runCompleted,
      runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.completed,
    });
  }

  /**
   * Records a scanner-worker runtime progress event after resolving tenant and assessment identity from the scan job.
   *
   * @param input - Worker supplied runtime metadata plus the scan-job identifier.
   * @returns A promise that resolves after the sanitized runtime event is persisted, or after the scan job is ignored because it is absent/inactive.
   */
  async recordScanWorkerEvent(
    input: RecordWorkerRuntimeEventInput,
  ): Promise<RecordWorkerRuntimeEventResult> {
    const scanJob = await this.prisma.repositoryScanJob.findUnique({
      where: { id: input.scanJobId },
      select: {
        id: true,
        assessmentId: true,
        organizationId: true,
        correlationId: true,
        status: true,
      },
    });
    if (!scanJob) {
      return { recorded: false, reason: "not_found" };
    }
    if (!isActiveScanRuntimeStatus(scanJob.status)) {
      return { recorded: false, reason: "inactive" };
    }

    await this.recordEvent({
      organizationId: scanJob.organizationId,
      assessmentId: scanJob.assessmentId,
      runId: scanJob.id,
      correlationId: scanJob.correlationId,
      eventType: input.eventType,
      runStatus: input.runStatus,
      stage: input.stage,
      toolName: input.toolName ?? null,
      summary: input.summary,
      inputSummary: input.inputSummary,
      outputSummary: input.outputSummary,
      errorSummary: input.errorSummary,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      durationMs: input.durationMs,
      attempt: input.attempt,
      waitingReason: input.waitingReason,
    });
    return { recorded: true };
  }

  /**
   * Builds the workspace runtime snapshot from persisted runtime events plus current scan-job and evidence-report state.
   *
   * @param organizationId - Organization whose assessment runtime state should be returned.
   * @returns Snapshot containing recent activity, derived runs, scan jobs, and evidence reports.
   */
  async buildWorkspaceSnapshot(
    organizationId: string,
  ): Promise<AssessmentRuntimeSnapshot> {
    const emittedAt = new Date().toISOString();
    const [events, scanJobs, evidenceReports] = await Promise.all([
      this.safeFindMany({
        where: { organizationId },
        orderBy: [{ createdAt: "desc" }, { sequence: "desc" }],
        take: 200,
      }),
      this.prisma.repositoryScanJob.findMany({
        where: { organizationId },
        orderBy: { updatedAt: "desc" },
        take: 50,
        select: {
          id: true,
          assessmentId: true,
          snapshotId: true,
          status: true,
          attemptCount: true,
          blockedReason: true,
          updatedAt: true,
        },
      }),
      this.prisma.technicalEvidenceReport.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          assessmentId: true,
          scanJobId: true,
          snapshotId: true,
          status: true,
          rejectionReason: true,
          createdAt: true,
        },
      }),
    ]);

    const persistedActivity = events.map((event) =>
      this.toActivityEvent(event),
    );
    const syntheticActivity = buildSyntheticRuntimeActivity(
      organizationId,
      scanJobs,
      evidenceReports,
      persistedActivity,
      emittedAt,
    );
    const recentActivity = [...persistedActivity, ...syntheticActivity]
      .sort((left, right) => right.emittedAt.localeCompare(left.emittedAt))
      .slice(0, 50);
    const runs = deriveRuns(events).slice(0, 20);

    return {
      emittedAt,
      runs,
      recentActivity,
      scanJobs: scanJobs.map((scanJob) => ({
        id: scanJob.id,
        assessmentId: scanJob.assessmentId,
        snapshotId: scanJob.snapshotId,
        status: scanJob.status,
        attemptCount: scanJob.attemptCount,
        blockedReason: scanJob.blockedReason,
        updatedAt: scanJob.updatedAt.toISOString(),
      })),
      evidenceReports: evidenceReports.map((report) => ({
        id: report.id,
        assessmentId: report.assessmentId,
        scanJobId: report.scanJobId,
        snapshotId: report.snapshotId,
        status: report.status,
        rejectionReason: report.rejectionReason,
        createdAt: report.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Sanitizes and persists one runtime event with a per-run sequence number, retrying sequence collisions up to three times.
   *
   * @param input - Complete runtime event data to sanitize and persist.
   * @returns A promise that resolves after persistence, or silently degrades when the runtime-event table has not been migrated yet.
   */
  private async recordEvent(input: RecordRuntimeEventInput): Promise<void> {
    const startedAt = input.startedAt ?? null;
    const completedAt = input.completedAt ?? null;
    const summary = sanitizeRuntimeSummaryText(input.summary);
    const inputSummary = sanitizeRuntimeSummaryValue(input.inputSummary);
    const outputSummary = sanitizeRuntimeSummaryValue(input.outputSummary);
    const errorSummary =
      input.errorSummary === null || input.errorSummary === undefined
        ? null
        : sanitizeRuntimeSummaryText(input.errorSummary);

    for (let index = 0; index < 3; index += 1) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const latest = (await runtimeEventDelegate(tx).findFirst({
            where: { runId: input.runId },
            orderBy: [{ sequence: "desc" }],
            select: { sequence: true },
          })) as { sequence: number } | null;
          await runtimeEventDelegate(tx).create({
            data: {
              organizationId: input.organizationId,
              assessmentId: input.assessmentId,
              runId: input.runId,
              correlationId: input.correlationId,
              sequence: (latest?.sequence ?? 0) + 1,
              eventType: input.eventType,
              runStatus: input.runStatus,
              stage: input.stage,
              toolName: input.toolName ?? null,
              summary: summary || FALLBACK_SUMMARY,
              inputSummaryJson: toJsonOrNull(inputSummary),
              outputSummaryJson: toJsonOrNull(outputSummary),
              errorSummary,
              startedAt,
              completedAt,
              durationMs: input.durationMs ?? null,
              attempt: input.attempt ?? null,
              waitingReason:
                input.waitingReason === null ||
                input.waitingReason === undefined
                  ? null
                  : sanitizeRuntimeSummaryText(input.waitingReason),
            },
          });
        });
        return;
      } catch (error) {
        if (isMissingAssessmentRuntimeEventTable(error)) {
          this.logRuntimeEventTableMissing("recordEvent", error);
          return;
        }
        if (!isUniqueSequenceViolation(error) || index === 2) {
          throw error;
        }
      }
    }
  }

  /**
   * Maps one persisted runtime-event row into the public activity-event contract.
   *
   * @param event - Persisted runtime-event row from Prisma.
   * @returns Contract activity event with timestamps converted to ISO strings.
   */
  private toActivityEvent(
    event: PersistedAssessmentRuntimeEvent,
  ): AssessmentRuntimeActivityEvent {
    return {
      eventId: event.id,
      sequence: event.sequence,
      emittedAt: event.createdAt.toISOString(),
      organizationId: event.organizationId,
      assessmentId: event.assessmentId,
      runId: event.runId,
      correlationId: event.correlationId,
      eventType: event.eventType as AssessmentRuntimeEventType,
      runStatus: event.runStatus as AssessmentRuntimeRunStatus,
      stage: event.stage as AssessmentRuntimeStageCode,
      toolName: event.toolName,
      summary: event.summary,
      inputSummary:
        (event.inputSummaryJson as AssessmentRuntimeSummaryValue | null) ??
        null,
      outputSummary:
        (event.outputSummaryJson as AssessmentRuntimeSummaryValue | null) ??
        null,
      errorSummary: event.errorSummary,
      startedAt: event.startedAt?.toISOString() ?? null,
      completedAt: event.completedAt?.toISOString() ?? null,
      durationMs: event.durationMs,
      attempt: event.attempt,
      waitingReason: event.waitingReason,
    };
  }

  /**
   * Queries the runtime-event delegate while treating a not-yet-migrated runtime-event table as an empty result.
   *
   * @param args - Prisma-compatible `findFirst` arguments forwarded to the runtime-event delegate.
   * @returns Query result, or null when the runtime-event table is unavailable.
   */
  private async safeFindFirst(args: Record<string, unknown>): Promise<unknown> {
    try {
      return (await runtimeEventDelegate(this.prisma).findFirst(
        args,
      )) as unknown;
    } catch (error) {
      if (isMissingAssessmentRuntimeEventTable(error)) {
        this.logRuntimeEventTableMissing("findFirst", error);
        return null;
      }
      throw error;
    }
  }

  /**
   * Queries multiple runtime events while treating a not-yet-migrated runtime-event table as an empty collection.
   *
   * @param args - Prisma-compatible `findMany` arguments forwarded to the runtime-event delegate.
   * @returns Persisted runtime-event rows, or an empty list when the table is unavailable.
   */
  private async safeFindMany(args: Record<string, unknown>) {
    try {
      return (await runtimeEventDelegate(this.prisma).findMany(
        args,
      )) as PersistedAssessmentRuntimeEvent[];
    } catch (error) {
      if (isMissingAssessmentRuntimeEventTable(error)) {
        this.logRuntimeEventTableMissing("findMany", error);
        return [];
      }
      throw error;
    }
  }

  /**
   * Logs the controlled fallback used when the assessment runtime-event migration has not yet been applied.
   *
   * @param operation - Runtime-event database operation that encountered the missing table.
   * @param error - Original database error used for debug-level diagnostics.
   */
  private logRuntimeEventTableMissing(operation: string, error: unknown) {
    this.logger.warn(
      `AssessmentRuntimeEvent table missing during ${operation}; returning empty runtime activity until migration 20260813235900_add_assessment_runtime_event is applied.`,
    );
    if (error instanceof Error) {
      this.logger.debug(error.message);
    }
  }
}

/**
 * Produces synthetic activity from scan jobs and evidence reports when equivalent persisted runtime events are not already present.
 *
 * @param organizationId - Organization attached to generated activity events.
 * @param scanJobs - Recent repository scan-job snapshots.
 * @param evidenceReports - Recent technical-evidence report snapshots.
 * @param existingActivity - Persisted activity used to remove duplicate synthetic event IDs.
 * @returns Synthetic activity events not represented by persisted runtime events.
 */
function buildSyntheticRuntimeActivity(
  organizationId: string,
  scanJobs: RuntimeScanJobSnapshot[],
  evidenceReports: RuntimeEvidenceReportSnapshot[],
  existingActivity: AssessmentRuntimeActivityEvent[],
  snapshotEmittedAt: string,
): AssessmentRuntimeActivityEvent[] {
  const existingEventIds = new Set(
    existingActivity.map((event) => event.eventId),
  );
  const scanJobsWithPersistedActivity = new Set(
    existingActivity.map((event) => event.runId),
  );
  return [
    ...scanJobs
      .filter((scanJob) => !scanJobsWithPersistedActivity.has(scanJob.id))
      .map((scanJob) =>
        scanJobToSyntheticRuntimeActivity(
          organizationId,
          scanJob,
          snapshotEmittedAt,
        ),
      ),
    ...evidenceReports.map((report) =>
      evidenceReportToSyntheticRuntimeActivity(organizationId, report),
    ),
  ].filter((event) => !existingEventIds.has(event.eventId));
}

/**
 * Maps repository scan-job state into a synthetic runtime activity event.
 *
 * @param organizationId - Organization that owns the scan job.
 * @param scanJob - Repository scan-job snapshot to convert.
 * @returns Synthetic scan activity event suitable for the runtime feed.
 */
function scanJobToSyntheticRuntimeActivity(
  organizationId: string,
  scanJob: RuntimeScanJobSnapshot,
  snapshotEmittedAt: string,
): AssessmentRuntimeActivityEvent {
  const runStatus = runtimeStatusForScanJob(scanJob.status);
  const isRunning = runStatus === ASSESSMENT_RUNTIME_RUN_STATUSES.running;
  const emittedAt = isRunning
    ? snapshotEmittedAt
    : scanJob.updatedAt.toISOString();
  return {
    eventId: `scan-job:${scanJob.id}:${scanJob.status}`,
    sequence: 0,
    emittedAt,
    organizationId,
    assessmentId: scanJob.assessmentId,
    runId: scanJob.id,
    correlationId: scanJob.id,
    eventType:
      runStatus === ASSESSMENT_RUNTIME_RUN_STATUSES.running
        ? ASSESSMENT_RUNTIME_EVENT_TYPES.toolStarted
        : runStatus === ASSESSMENT_RUNTIME_RUN_STATUSES.failed
          ? ASSESSMENT_RUNTIME_EVENT_TYPES.toolFailed
          : ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
    runStatus,
    stage: ASSESSMENT_RUNTIME_STAGE_CODES.scan,
    toolName: "repository_scan",
    summary: scanJobSummary(scanJob),
    inputSummary: { snapshotId: scanJob.snapshotId },
    outputSummary: isRunning
      ? { status: scanJob.status, observedAt: snapshotEmittedAt }
      : { status: scanJob.status },
    errorSummary: scanJob.blockedReason,
    startedAt: null,
    completedAt:
      runStatus === ASSESSMENT_RUNTIME_RUN_STATUSES.running
        ? null
        : scanJob.updatedAt.toISOString(),
    durationMs: null,
    attempt: scanJob.attemptCount,
    waitingReason:
      runStatus === ASSESSMENT_RUNTIME_RUN_STATUSES.waiting
        ? scanJob.blockedReason
        : null,
  };
}

/**
 * Maps a technical-evidence report into a synthetic runtime completion or failure activity event.
 *
 * @param organizationId - Organization that owns the evidence report.
 * @param report - Technical-evidence report snapshot to convert.
 * @returns Synthetic evidence-report activity event suitable for the runtime feed.
 */
function evidenceReportToSyntheticRuntimeActivity(
  organizationId: string,
  report: RuntimeEvidenceReportSnapshot,
): AssessmentRuntimeActivityEvent {
  const failed = report.status === TECHNICAL_EVIDENCE_REPORT_STATUSES.rejected;
  return {
    eventId: `technical-evidence-report:${report.id}:${report.status}`,
    sequence: 0,
    emittedAt: report.createdAt.toISOString(),
    organizationId,
    assessmentId: report.assessmentId,
    runId: report.scanJobId,
    correlationId: report.scanJobId,
    eventType: failed
      ? ASSESSMENT_RUNTIME_EVENT_TYPES.toolFailed
      : ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
    runStatus: failed
      ? ASSESSMENT_RUNTIME_RUN_STATUSES.failed
      : ASSESSMENT_RUNTIME_RUN_STATUSES.completed,
    stage: ASSESSMENT_RUNTIME_STAGE_CODES.technicalEvidence,
    toolName: "technical_evidence_report",
    summary: failed
      ? "Technical evidence report was rejected"
      : "Technical evidence report was accepted",
    inputSummary: {
      scanJobId: report.scanJobId,
      snapshotId: report.snapshotId,
    },
    outputSummary: { status: report.status },
    errorSummary: report.rejectionReason,
    startedAt: null,
    completedAt: report.createdAt.toISOString(),
    durationMs: null,
    attempt: null,
    waitingReason: null,
  };
}

/**
 * Maps repository scan-job status to the normalized assessment runtime run status.
 *
 * @param status - Repository scan-job status value.
 * @returns Runtime status used by the activity contract.
 */
function runtimeStatusForScanJob(status: string): AssessmentRuntimeRunStatus {
  if (status === REPOSITORY_SCAN_JOB_STATUSES.running) {
    return ASSESSMENT_RUNTIME_RUN_STATUSES.running;
  }
  if (status === REPOSITORY_SCAN_JOB_STATUSES.completed) {
    return ASSESSMENT_RUNTIME_RUN_STATUSES.completed;
  }
  if (
    status === REPOSITORY_SCAN_JOB_STATUSES.failed ||
    status === REPOSITORY_SCAN_JOB_STATUSES.blocked ||
    status === REPOSITORY_SCAN_JOB_STATUSES.blockedMapping
  ) {
    return ASSESSMENT_RUNTIME_RUN_STATUSES.failed;
  }
  return ASSESSMENT_RUNTIME_RUN_STATUSES.waiting;
}

function isActiveScanRuntimeStatus(status: string): boolean {
  return (
    status === REPOSITORY_SCAN_JOB_STATUSES.queued ||
    status === REPOSITORY_SCAN_JOB_STATUSES.running
  );
}

/**
 * Builds a concise human-readable summary for a repository scan job.
 *
 * @param scanJob - Repository scan-job snapshot whose status and blocked reason should be summarized.
 * @returns Runtime summary text for the scan job.
 */
function scanJobSummary(scanJob: RuntimeScanJobSnapshot): string {
  const status = runtimeStatusForScanJob(scanJob.status);
  if (status === ASSESSMENT_RUNTIME_RUN_STATUSES.running) {
    return "Repository scan is running";
  }
  if (status === ASSESSMENT_RUNTIME_RUN_STATUSES.completed) {
    return "Repository scan completed";
  }
  if (status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed) {
    return scanJob.blockedReason ?? "Repository scan failed";
  }
  return scanJob.blockedReason ?? "Repository scan is waiting";
}

/**
 * Groups persisted activity by run and derives each run's latest stage, status, active tools, and update time.
 *
 * @param events - Persisted runtime events to group chronologically by run ID.
 * @returns Derived runs sorted by most recent update first.
 */
function deriveRuns(
  events: PersistedAssessmentRuntimeEvent[],
): AssessmentRuntimeRun[] {
  const byRunId = new Map<string, PersistedAssessmentRuntimeEvent[]>();
  for (const event of [...events].reverse()) {
    const group = byRunId.get(event.runId) ?? [];
    group.push(event);
    byRunId.set(event.runId, group);
  }

  const runs: AssessmentRuntimeRun[] = [];
  for (const group of byRunId.values()) {
    const latest = group[group.length - 1];
    if (!latest) {
      continue;
    }
    runs.push({
      assessmentId: latest.assessmentId,
      runId: latest.runId,
      stage: latest.stage as AssessmentRuntimeStageCode,
      status: latest.runStatus as AssessmentRuntimeRunStatus,
      activeTools: deriveActiveTools(group),
      updatedAt: latest.createdAt.toISOString(),
    });
  }

  return runs.sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

/**
 * Derives tools that are still active after replaying a run's tool lifecycle events in order.
 *
 * @param events - Chronological runtime events belonging to one run.
 * @returns Tool descriptors that have started but have not completed, failed, skipped, or begun waiting for input.
 */
function deriveActiveTools(
  events: PersistedAssessmentRuntimeEvent[],
): AssessmentRuntimeActiveTool[] {
  const active = new Map<string, AssessmentRuntimeActiveTool>();
  for (const event of events) {
    if (!event.toolName) {
      continue;
    }
    if (event.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolStarted) {
      active.set(event.toolName, {
        toolName: event.toolName,
        status: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
        summary: event.summary,
        startedAt: event.startedAt?.toISOString() ?? null,
        attempt: event.attempt,
      });
      continue;
    }
    if (
      event.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted ||
      event.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolFailed ||
      event.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolSkipped ||
      event.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolWaitingInput
    ) {
      active.delete(event.toolName);
    }
  }
  return Array.from(active.values());
}

/**
 * Converts a sanitized runtime summary into a Prisma JSON input value while preserving null as database null.
 *
 * @param value - Sanitized runtime summary value to persist.
 * @returns Prisma-compatible JSON value or null.
 */
function toJsonOrNull(
  value: AssessmentRuntimeSummaryValue | null,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | null {
  if (value === null) {
    return null;
  }
  return value;
}

/**
 * Detects the unique-key collision raised when concurrent writers choose the same per-run event sequence.
 *
 * @param error - Unknown persistence error to inspect.
 * @returns True when the error identifies the `runId_sequence_key` constraint.
 */
function isUniqueSequenceViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes("runId_sequence_key");
}

/**
 * Detects database errors caused by the assessment runtime-event table not yet existing.
 *
 * @param error - Unknown database error to inspect.
 * @returns True when the error reports a missing `AssessmentRuntimeEvent` table.
 */
function isMissingAssessmentRuntimeEventTable(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("AssessmentRuntimeEvent") &&
    (error.message.includes("does not exist") ||
      error.message.includes("does not exist in the current database"))
  );
}

/**
 * Converts an arbitrary runtime failure into the shared privacy-safe summary text.
 *
 * @param error - Error or thrown value to summarize.
 * @returns Sanitized runtime failure summary.
 */
export function summarizeFailure(error: unknown): string {
  return summarizeRuntimeError(error);
}

/**
 * Accesses the assessment-runtime-event Prisma delegate without requiring generated client typing at compile time.
 *
 * @param prisma - Prisma service or transaction client expected to expose the runtime-event delegate.
 * @returns Runtime-event delegate supporting `findFirst`, `findMany`, and `create` operations.
 */
function runtimeEventDelegate(prisma: unknown) {
  return (
    prisma as {
      assessmentRuntimeEvent: {
        findFirst: (...args: any[]) => Promise<any>;
        findMany: (...args: any[]) => Promise<any[]>;
        create: (...args: any[]) => Promise<any>;
      };
    }
  ).assessmentRuntimeEvent;
}
