import { randomUUID } from "node:crypto";
import {
  ASSESSMENT_RUNTIME_EVENT_TYPES,
  ASSESSMENT_RUNTIME_ENGINEERING_PROGRESS_TOOL_NAMES,
  ASSESSMENT_RUNTIME_ENGINEERING_RULE_TOOL_PREFIXES,
  ASSESSMENT_RUNTIME_PLAN_REASON_CODES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  ASSESSMENT_RUNTIME_STAGE_CODES,
  ASSESSMENT_RUNTIME_SYNTHETIC_TOOL_NAMES,
  isAssessmentAgentStreamEventType,
  isPostFindingRuntimePhase,
  isRemediationDecision,
  REMEDIATION_APPROVAL_STATUSES,
  VERIFICATION_RESULT_STATUSES,
  FINAL_ASSESSMENT_RESULT_STATUSES,
  type AssessmentAgentStreamEvent,
  type AssessmentAgentStreamEventType,
  type AssessmentPostFindingActivity,
  type AssessmentPostFindingRuntimeState,
  type AssessmentRuntimeEventType,
  type AssessmentRuntimeEngineeringProgress,
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
import {
  Observable,
  ReplaySubject,
  defer,
  filter,
  from,
  map,
  merge,
  mergeMap,
} from "rxjs";

import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import {
  failStaleRepositoryScanJobs,
  STALE_REPOSITORY_SCAN_BLOCKED_REASON,
} from "../scan/repository-scan-staleness.js";
import {
  FALLBACK_SUMMARY,
  sanitizeRuntimeSummaryText,
  sanitizeRuntimeSummaryValue,
  summarizeRuntimeError,
} from "./runtime-summary-sanitizer.js";
import {
  sanitizeAgentStreamIdentifier,
  sanitizeAgentStreamText,
  sanitizeAgentStreamValue,
} from "./agent-stream-sanitizer.js";

const RUNTIME_EVENT_SEQUENCE_RETRY_ATTEMPTS = 8;
const RUNTIME_EVENT_SEQUENCE_RETRY_DELAY_MS = 5;
const ENGINEERING_PROGRESS_DURABLE_MAX_RUNS = 10;
const ENGINEERING_PROGRESS_SUMMARY_SCAN_LIMIT = 40;
const ENGINEERING_PROGRESS_INVESTIGATION_SCAN_LIMIT = 1_000;
const AGENT_STREAM_JOURNAL_TOOL_NAME = "agent_stream_semantic";
const AGENT_STREAM_DURABLE_REPLAY_TOTAL_LIMIT = 5_000;
const AGENT_STREAM_DURABLE_REPLAY_ASSESSMENT_LIMIT = 100;
const AGENT_STREAM_DURABLE_REPLAY_QUERY_CONCURRENCY = 4;
const AGENT_STREAM_EVENT_DEDUPE_SEEN_LIMIT =
  AGENT_STREAM_DURABLE_REPLAY_TOTAL_LIMIT + 1_000;
const AGENT_STREAM_HISTORY_DEFAULT_LIMIT = 500;
const AGENT_STREAM_HISTORY_MAX_LIMIT = 5_000;
const INVALID_ASSESSMENT_STREAM_SCOPE = "__invalid_assessment_stream_scope__";

export type PublishAgentStreamEventInput = {
  eventId?: string | null;
  clientSequence?: number | null;
  assessmentId: string;
  runId: string;
  correlationId: string;
  eventType: AssessmentAgentStreamEventType;
  source?: string | null;
  agentName?: string | null;
  subagentName?: string | null;
  namespace?: string[] | null;
  nodeName?: string | null;
  messageId?: string | null;
  toolName?: string | null;
  toolCallId?: string | null;
  status?: string | null;
  text?: string | null;
  data?: unknown;
};

type RecordRuntimeEventInput = {
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
  summaryMaxDepth?: number;
  summaryMaxItems?: number;
};

type EnsureRunInput = {
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
  "assessmentId" | "runId" | "correlationId"
> & {
  scanJobId: string;
};

export type RecordWorkerRuntimeEventResult =
  | { recorded: true }
  | { recorded: false; reason: "not_found" | "inactive" | "terminal" };

type PersistedAssessmentRuntimeEvent = {
  id: string;
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

type RuntimeRepositorySnapshot = {
  id: string;
  assessmentId: string;
  repositoryFullName: string | null;
  branch: string | null;
  commitSha: string;
  connection?: { provider: string } | null;
  createdAt: Date;
};

type OwnedAssessmentAgentStreamEvent = {
  ownerId: string;
  event: AssessmentAgentStreamEvent;
};

type ObserveAgentStreamEventsOptions = {
  assessmentId?: string | null;
};

export type AgentStreamHistoryPage = {
  events: AssessmentAgentStreamEvent[];
  nextCursor: string | null;
  hasMore: boolean;
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
  private readonly agentStreamEvents =
    new ReplaySubject<OwnedAssessmentAgentStreamEvent>(1_000);
  private readonly assessmentOwnerIds = new Map<string, string>();
  private agentStreamSequence = 0;

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
   * Records that a pipeline tool was intentionally not executed, as a terminal state.
   *
   * @param input - Runtime event data excluding the event type and run status supplied by this method.
   * @returns A promise that resolves after the tool-skipped event is persisted.
   */
  async recordToolSkipped(
    input: Omit<RecordRuntimeEventInput, "eventType" | "runStatus">,
  ): Promise<void> {
    await this.recordEvent({
      ...input,
      eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolSkipped,
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
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.recordEvent(
      {
        ...input,
        eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolWaitingInput,
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.waiting,
      },
      tx,
    );
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
   * Records failed completion of an assessment runtime run.
   *
   * @param input - Runtime event data excluding the event type and run status supplied by this method.
   * @returns A promise that resolves after the run-failed event is persisted.
   */
  async recordRunFailed(
    input: Omit<RecordRuntimeEventInput, "eventType" | "runStatus">,
  ): Promise<void> {
    await this.recordEvent({
      ...input,
      eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.runFailed,
      runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.failed,
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
        correlationId: true,
        status: true,
      },
    });
    if (!scanJob) {
      return { recorded: false, reason: "not_found" };
    }
    const isTerminalWorkerEvent = isTerminalWorkerRuntimeEvent(input.eventType);
    if (isTerminalScanRuntimeStatus(scanJob.status) && !isTerminalWorkerEvent) {
      return { recorded: false, reason: "terminal" };
    }
    if (!isActiveScanRuntimeStatus(scanJob.status) && !isTerminalWorkerEvent) {
      return { recorded: false, reason: "inactive" };
    }

    await this.recordEvent({
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
    await this.publishAgentStreamEvent({
      assessmentId: scanJob.assessmentId,
      runId: scanJob.id,
      correlationId: scanJob.correlationId,
      eventType: "RUNTIME_EVENT",
      source: "runtime-event",
      toolName: input.toolName ?? null,
      status: input.runStatus,
      text: input.summary,
      data: {
        runtimeEventType: input.eventType,
        stage: input.stage,
        inputSummary: input.inputSummary ?? null,
        outputSummary: input.outputSummary ?? null,
        errorSummary: input.errorSummary ?? null,
        waitingReason: input.waitingReason ?? null,
        attempt: input.attempt ?? null,
      },
    });
    return { recorded: true };
  }

  /** Publish one redacted, bounded live event to connected workspace clients. */
  async publishAgentStreamEvent(
    input: PublishAgentStreamEventInput,
  ): Promise<AssessmentAgentStreamEvent | null> {
    const ownerId = await this.resolveAssessmentOwnerId(input.assessmentId);
    if (ownerId === null) {
      this.logger.warn(
        `Agent stream event ignored for unknown assessment ${input.assessmentId}`,
      );
      return null;
    }
    const event: AssessmentAgentStreamEvent = {
      eventId: sanitizeAgentStreamIdentifier(input.eventId) ?? randomUUID(),
      sequence: this.nextAgentStreamSequence(),
      clientSequence: input.clientSequence ?? null,
      emittedAt: new Date().toISOString(),
      assessmentId:
        sanitizeAgentStreamIdentifier(input.assessmentId) ?? input.assessmentId,
      runId: sanitizeAgentStreamIdentifier(input.runId) ?? input.runId,
      correlationId:
        sanitizeAgentStreamIdentifier(input.correlationId) ??
        input.correlationId,
      eventType: input.eventType,
      source: sanitizeAgentStreamIdentifier(input.source),
      agentName: sanitizeAgentStreamIdentifier(input.agentName),
      subagentName: sanitizeAgentStreamIdentifier(input.subagentName),
      namespace: (input.namespace ?? []).slice(0, 32).flatMap((item) => {
        const sanitized = sanitizeAgentStreamIdentifier(item);
        return sanitized === null ? [] : [sanitized];
      }),
      nodeName: sanitizeAgentStreamIdentifier(input.nodeName),
      messageId: sanitizeAgentStreamIdentifier(input.messageId),
      toolName: sanitizeAgentStreamIdentifier(input.toolName),
      toolCallId: sanitizeAgentStreamIdentifier(input.toolCallId),
      status: sanitizeAgentStreamIdentifier(input.status),
      text: sanitizeAgentStreamText(input.text),
      data: sanitizeAgentStreamValue(input.data),
    };
    if (isPersistableAgentStreamEvent(event)) {
      await this.persistAgentStreamJournalEvent(event);
    }
    this.agentStreamEvents.next({ ownerId, event });
    return event;
  }

  /** Observe live events belonging only to assessments owned by one customer. */
  observeAgentStreamEvents(
    ownerId: string,
    options?: ObserveAgentStreamEventsOptions,
  ): Observable<AssessmentAgentStreamEvent> {
    const assessmentId = normalizeAssessmentStreamScope(options?.assessmentId);
    return merge(
      defer(() =>
        from(this.getDurableAgentStreamEvents(ownerId, assessmentId)).pipe(
          mergeMap((events) => from(events)),
        ),
      ),
      this.agentStreamEvents.pipe(
        filter(
          (entry) =>
            entry.ownerId === ownerId &&
            (assessmentId === null ||
              entry.event.assessmentId === assessmentId),
        ),
        map((entry) => entry.event),
      ),
    ).pipe(
      filter(
        createBoundedAgentStreamEventDedupe(
          AGENT_STREAM_EVENT_DEDUPE_SEEN_LIMIT,
        ),
      ),
    );
  }

  private async resolveAssessmentOwnerId(
    assessmentId: string,
  ): Promise<string | null> {
    const cached = this.assessmentOwnerIds.get(assessmentId);
    if (cached) return cached;
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: { ownerId: true },
    });
    if (!assessment) return null;
    this.assessmentOwnerIds.set(assessmentId, assessment.ownerId);
    return assessment.ownerId;
  }

  private async persistAgentStreamJournalEvent(
    event: AssessmentAgentStreamEvent,
  ): Promise<void> {
    await this.recordEvent({
      assessmentId: event.assessmentId,
      runId: event.runId,
      correlationId: event.correlationId,
      eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
      runStatus:
        event.status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed
          ? ASSESSMENT_RUNTIME_RUN_STATUSES.failed
          : ASSESSMENT_RUNTIME_RUN_STATUSES.running,
      stage: ASSESSMENT_RUNTIME_STAGE_CODES.technicalEvidence,
      toolName: AGENT_STREAM_JOURNAL_TOOL_NAME,
      summary: agentStreamJournalSummary(event),
      outputSummary: {
        agentStreamEvent: event,
        semanticPayloads: event.data === null ? [] : [event.data],
      },
      summaryMaxDepth: 8,
      summaryMaxItems: 100,
    });
  }

  private async getDurableAgentStreamEvents(
    ownerId: string,
    assessmentId: string | null = null,
  ): Promise<AssessmentAgentStreamEvent[]> {
    if (assessmentId !== null) {
      return (
        await this.getAgentStreamHistoryPage(ownerId, assessmentId, {
          limit: AGENT_STREAM_DURABLE_REPLAY_TOTAL_LIMIT,
        })
      ).events;
    }
    const assessmentIds = await this.getOwnedAssessmentIds(ownerId);
    const rowsByAssessment = await mapWithConcurrency(
      assessmentIds,
      AGENT_STREAM_DURABLE_REPLAY_QUERY_CONCURRENCY,
      async (replayAssessmentId, index) =>
        this.safeFindMany({
          where: {
            assessmentId: replayAssessmentId,
            assessment: { ownerId },
            toolName: AGENT_STREAM_JOURNAL_TOOL_NAME,
          },
          orderBy: [{ createdAt: "desc" }, { sequence: "desc" }],
          take: durableReplayLimitForAssessment(index, assessmentIds.length),
        }),
    );
    return rowsByAssessment
      .flatMap((rows) => [...rows].reverse())
      .flatMap((row) => {
        const event = agentStreamJournalEventFromRow(row);
        return event === null ? [] : [event];
      })
      .sort(compareAgentStreamEvents);
  }

  async getAgentStreamHistoryPage(
    ownerId: string,
    assessmentId: string,
    options?: { cursor?: string | null; limit?: number | null },
  ): Promise<AgentStreamHistoryPage> {
    const assessmentIds = await this.getOwnedAssessmentId(
      ownerId,
      assessmentId,
    );
    if (assessmentIds.length === 0) {
      return { events: [], nextCursor: null, hasMore: false };
    }
    const limit = normalizeAgentStreamHistoryLimit(options?.limit);
    const cursor = decodeAgentStreamHistoryCursor(options?.cursor);
    const rows = await this.safeFindMany({
      where: {
        AND: [
          {
            assessmentId,
            assessment: { ownerId },
            toolName: AGENT_STREAM_JOURNAL_TOOL_NAME,
          },
          ...(cursor === null ? [] : [agentStreamHistoryCursorWhere(cursor)]),
        ],
      },
      orderBy: [{ createdAt: "desc" }, { sequence: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const pageRows = rows.slice(0, limit);
    const events = [...pageRows]
      .reverse()
      .flatMap((row) => {
        const event = agentStreamJournalEventFromRow(row);
        return event === null ? [] : [event];
      })
      .sort(compareAgentStreamEvents);
    const lastRow = pageRows.at(-1);
    return {
      events,
      hasMore: rows.length > limit,
      nextCursor:
        rows.length > limit && lastRow
          ? encodeAgentStreamHistoryCursor(lastRow)
          : null,
    };
  }

  private nextAgentStreamSequence(): number {
    const timestampSequence = Date.now() * 1_000;
    this.agentStreamSequence = Math.max(
      this.agentStreamSequence + 1,
      timestampSequence,
    );
    return this.agentStreamSequence;
  }

  private async getOwnedAssessmentIds(ownerId: string): Promise<string[]> {
    const assessments = await this.prisma.assessment.findMany({
      where: { ownerId },
      orderBy: { updatedAt: "desc" },
      take: AGENT_STREAM_DURABLE_REPLAY_ASSESSMENT_LIMIT,
      select: { id: true },
    });
    return assessments.flatMap((assessment) =>
      typeof assessment.id === "string" ? [assessment.id] : [],
    );
  }

  private async getOwnedAssessmentId(
    ownerId: string,
    assessmentId: string,
  ): Promise<string[]> {
    const assessmentOwnerId = await this.resolveAssessmentOwnerId(assessmentId);
    return assessmentOwnerId === ownerId ? [assessmentId] : [];
  }

  /**
   * Returns the newest exact Planner batch and its durable per-rule Investigator
   * events for one assessment. Unlike workspace recent activity this reads the
   * persisted runtime-event history for the selected batch, so artifact projections
   * do not drift when events leave the rolling activity window.
   */
  async getLatestDurableEngineeringState(assessmentId: string): Promise<{
    progress: AssessmentRuntimeEngineeringProgress;
    plannerEvent: AssessmentRuntimeActivityEvent;
    investigationEvents: AssessmentRuntimeActivityEvent[];
  } | null> {
    const [summary] = await this.safeFindMany({
      where: {
        assessmentId,
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.technicalEvidence,
        toolName:
          ASSESSMENT_RUNTIME_ENGINEERING_PROGRESS_TOOL_NAMES.plannerSummary,
      },
      orderBy: [{ createdAt: "desc" }, { sequence: "desc" }],
      take: 1,
    });
    if (!summary) return null;

    const rows = await this.safeFindMany({
      where: {
        assessmentId,
        runId: summary.runId,
        sequence: { gt: summary.sequence },
        toolName: {
          startsWith:
            ASSESSMENT_RUNTIME_ENGINEERING_RULE_TOOL_PREFIXES.investigator,
        },
      },
      orderBy: [{ sequence: "asc" }],
      take: ENGINEERING_PROGRESS_INVESTIGATION_SCAN_LIMIT,
    });
    const plannerEvent = this.toActivityEvent(summary);
    const investigationEvents = rows.map((row) => this.toActivityEvent(row));
    const ordered = [plannerEvent, ...investigationEvents].sort(
      (left, right) => left.sequence - right.sequence,
    );
    return {
      progress: deriveExplicitEngineeringProgress(ordered, plannerEvent),
      plannerEvent,
      investigationEvents,
    };
  }

  /**
   * Returns the most recent persisted workflow run start for stale-artifact checks.
   * This is intentionally separate from rolling workspace activity projections.
   */
  async getLatestAssessmentRunStart(assessmentId: string): Promise<{
    runId: string;
    emittedAt: string;
  } | null> {
    const [row] = await this.safeFindMany({
      where: {
        assessmentId,
        eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.runStarted,
      },
      orderBy: [{ createdAt: "desc" }, { sequence: "desc" }],
      take: 1,
    });
    if (!row) return null;
    const event = this.toActivityEvent(row);
    return { runId: event.runId, emittedAt: event.emittedAt };
  }

  /**
   * Builds the workspace runtime snapshot from persisted runtime events plus current scan-job and evidence-report state.
   *
   * @returns Snapshot containing recent activity, derived runs, scan jobs, and evidence reports.
   */
  async buildWorkspaceSnapshot(
    ownerId?: string,
  ): Promise<AssessmentRuntimeSnapshot> {
    const emittedAt = new Date().toISOString();
    await failStaleRepositoryScanJobs(this.prisma, {
      now: new Date(emittedAt),
    });
    const [events, repositorySnapshots, scanJobs, evidenceReports] =
      await Promise.all([
        this.safeFindMany({
          where: nonAgentStreamJournalWhere(
            ownerId ? { assessment: { ownerId } } : undefined,
          ),
          orderBy: [{ createdAt: "desc" }, { sequence: "desc" }],
          take: 200,
        }),
        this.prisma.repositorySnapshot.findMany({
          ...(ownerId ? { where: { assessment: { ownerId } } } : {}),
          orderBy: { createdAt: "desc" },
          take: 50,
          select: {
            id: true,
            assessmentId: true,
            repositoryFullName: true,
            branch: true,
            commitSha: true,
            connection: { select: { provider: true } },
            createdAt: true,
          },
        }),
        this.prisma.repositoryScanJob.findMany({
          ...(ownerId ? { where: { assessment: { ownerId } } } : {}),
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
          ...(ownerId ? { where: { assessment: { ownerId } } } : {}),
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
    const engineeringProgress =
      await this.deriveDurableEngineeringProgress(persistedActivity);
    const syntheticActivity = buildSyntheticRuntimeActivity(
      scanJobs,
      evidenceReports,
      persistedActivity,
      emittedAt,
    );
    const recentActivity = [...persistedActivity, ...syntheticActivity]
      .sort((left, right) => right.emittedAt.localeCompare(left.emittedAt))
      .slice(0, 50);
    const runs = deriveRuns(recentActivity).slice(0, 20);
    const postFindingStates = deriveLatestPostFindingStates(events);

    return {
      emittedAt,
      runs,
      recentActivity,
      engineeringProgress,
      repositorySnapshots: repositorySnapshots.map(
        (snapshot: RuntimeRepositorySnapshot) => ({
          id: snapshot.id,
          assessmentId: snapshot.assessmentId,
          provider: snapshot.connection?.provider ?? null,
          repositoryFullName: snapshot.repositoryFullName,
          branch: snapshot.branch,
          commitSha: snapshot.commitSha,
          createdAt: snapshot.createdAt.toISOString(),
        }),
      ),
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
      postFindingStates,
    };
  }

  async getLatestPostFindingState(
    assessmentId: string,
  ): Promise<AssessmentPostFindingRuntimeState | null> {
    const events = await this.safeFindMany({
      where: nonAgentStreamJournalWhere({ assessmentId }),
      orderBy: [{ createdAt: "desc" }, { sequence: "desc" }],
      take: 200,
    });
    return (
      deriveLatestPostFindingStates(events).find(
        (state) => state.assessmentId === assessmentId,
      ) ?? null
    );
  }

  /**
   * Sanitizes and persists one runtime event with a per-run sequence number, retrying sequence collisions from concurrent writers.
   *
   * @param input - Complete runtime event data to sanitize and persist.
   * @returns A promise that resolves after persistence, or silently degrades when the runtime-event table has not been migrated yet.
   */
  private async recordEvent(
    input: RecordRuntimeEventInput,
    existingTx?: Prisma.TransactionClient,
  ): Promise<void> {
    const startedAt = input.startedAt ?? null;
    const completedAt = input.completedAt ?? null;
    const summary = sanitizeRuntimeSummaryText(input.summary);
    const summaryOptions = {
      maxDepth: input.summaryMaxDepth,
      maxItems: input.summaryMaxItems,
    };
    const inputSummary = sanitizeRuntimeSummaryValue(
      input.inputSummary,
      summaryOptions,
    );
    const outputSummary = sanitizeRuntimeSummaryValue(
      input.outputSummary,
      summaryOptions,
    );
    const errorSummary =
      input.errorSummary === null || input.errorSummary === undefined
        ? null
        : sanitizeRuntimeSummaryText(input.errorSummary);

    const persist = async (tx: Prisma.TransactionClient): Promise<void> => {
      const latest = (await runtimeEventDelegate(tx).findFirst({
        where: { runId: input.runId },
        orderBy: [{ sequence: "desc" }],
        select: { sequence: true },
      })) as { sequence: number } | null;
      await runtimeEventDelegate(tx).create({
        data: {
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
            input.waitingReason === null || input.waitingReason === undefined
              ? null
              : sanitizeRuntimeSummaryText(input.waitingReason),
        },
      });
    };

    if (existingTx) {
      // The caller owns atomicity/retry. Do not open a nested transaction:
      // a failure must abort the caller's transaction so durable state cannot
      // commit without its corresponding runtime transition.
      await persist(existingTx);
      return;
    }

    for (
      let index = 0;
      index < RUNTIME_EVENT_SEQUENCE_RETRY_ATTEMPTS;
      index += 1
    ) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await persist(tx);
        });
        return;
      } catch (error) {
        if (isMissingAssessmentRuntimeEventTable(error)) {
          this.logRuntimeEventTableMissing("recordEvent", error);
          return;
        }
        if (
          !isUniqueSequenceViolation(error) ||
          index === RUNTIME_EVENT_SEQUENCE_RETRY_ATTEMPTS - 1
        ) {
          throw error;
        }
        await delayRuntimeEventSequenceRetry(index);
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
   * Derives authoritative Planner/Investigator progress per run from durable
   * planner-summary and investigator runtime events, never from the bounded
   * recent-activity window. Window-derived approximations remain only as a
   * compatibility fallback for runs that have not persisted a planner summary.
   *
   * @param persistedActivity - Window activity used only for the legacy fallback.
   * @returns Authoritative progress per run, newest planning batch first.
   */
  private async deriveDurableEngineeringProgress(
    persistedActivity: AssessmentRuntimeActivityEvent[],
  ): Promise<AssessmentRuntimeEngineeringProgress[]> {
    const windowProgress = deriveEngineeringProgress(persistedActivity);
    const durableProgress =
      await this.deriveExplicitEngineeringProgressFromDurableState();
    const progressByRun = new Map<
      string,
      AssessmentRuntimeEngineeringProgress
    >();
    for (const progress of windowProgress) {
      progressByRun.set(`${progress.assessmentId}:${progress.runId}`, progress);
    }
    for (const progress of durableProgress) {
      progressByRun.set(`${progress.assessmentId}:${progress.runId}`, progress);
    }
    return [...progressByRun.values()].sort((left, right) =>
      right.planningBatchId.localeCompare(left.planningBatchId),
    );
  }

  /**
   * Projects canonical Planner/Investigator counts from persisted
   * `engineering_rule_plan_summary` events and the investigator events that
   * follow each run's latest summary. These queries read the full durable
   * event history for the affected runs, so eviction from the rolling
   * recent-activity window can never change canonical totals.
   *
   * @returns Explicit (non-approximate) progress for the most recent runs.
   */
  private async deriveExplicitEngineeringProgressFromDurableState(): Promise<
    AssessmentRuntimeEngineeringProgress[]
  > {
    const summaryRows = await this.safeFindMany({
      where: {
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.technicalEvidence,
        toolName:
          ASSESSMENT_RUNTIME_ENGINEERING_PROGRESS_TOOL_NAMES.plannerSummary,
      },
      orderBy: [{ createdAt: "desc" }, { sequence: "desc" }],
      take: ENGINEERING_PROGRESS_SUMMARY_SCAN_LIMIT,
    });
    const latestSummaryByRun = new Map<
      string,
      PersistedAssessmentRuntimeEvent
    >();
    for (const row of summaryRows) {
      const key = `${row.assessmentId}:${row.runId}`;
      if (!latestSummaryByRun.has(key)) {
        latestSummaryByRun.set(key, row);
      }
    }
    const recentRuns = [...latestSummaryByRun.entries()].slice(
      0,
      ENGINEERING_PROGRESS_DURABLE_MAX_RUNS,
    );
    const progressList: AssessmentRuntimeEngineeringProgress[] = [];
    for (const [, summary] of recentRuns) {
      const investigationRows = await this.safeFindMany({
        where: {
          runId: summary.runId,
          sequence: { gt: summary.sequence },
          toolName: {
            startsWith:
              ASSESSMENT_RUNTIME_ENGINEERING_RULE_TOOL_PREFIXES.investigator,
          },
        },
        orderBy: [{ sequence: "asc" }],
        take: ENGINEERING_PROGRESS_INVESTIGATION_SCAN_LIMIT,
      });
      const plannerEvent = this.toActivityEvent(summary);
      const ordered = [
        plannerEvent,
        ...investigationRows.map((row) => this.toActivityEvent(row)),
      ].sort((left, right) => left.sequence - right.sequence);
      progressList.push(
        deriveExplicitEngineeringProgress(ordered, plannerEvent),
      );
    }
    return progressList;
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
 * @param scanJobs - Recent repository scan-job snapshots.
 * @param evidenceReports - Recent technical-evidence report snapshots.
 * @param existingActivity - Persisted activity used to remove duplicate synthetic event IDs.
 * @returns Synthetic activity events not represented by persisted runtime events.
 */
function buildSyntheticRuntimeActivity(
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
      .filter(
        (scanJob) =>
          !scanJobsWithPersistedActivity.has(scanJob.id) ||
          isStaleFailedScanJob(scanJob),
      )
      .map((scanJob) =>
        scanJobToSyntheticRuntimeActivity(scanJob, snapshotEmittedAt),
      ),
    ...evidenceReports.map((report) =>
      evidenceReportToSyntheticRuntimeActivity(report),
    ),
  ].filter((event) => !existingEventIds.has(event.eventId));
}

function isStaleFailedScanJob(scanJob: RuntimeScanJobSnapshot): boolean {
  return (
    scanJob.status === REPOSITORY_SCAN_JOB_STATUSES.failed &&
    scanJob.blockedReason === STALE_REPOSITORY_SCAN_BLOCKED_REASON
  );
}

/**
 * Maps repository scan-job state into a synthetic runtime activity event.
 *
 * @param scanJob - Repository scan-job snapshot to convert.
 * @returns Synthetic scan activity event suitable for the runtime feed.
 */
function scanJobToSyntheticRuntimeActivity(
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
 * @param report - Technical-evidence report snapshot to convert.
 * @returns Synthetic evidence-report activity event suitable for the runtime feed.
 */
function evidenceReportToSyntheticRuntimeActivity(
  report: RuntimeEvidenceReportSnapshot,
): AssessmentRuntimeActivityEvent {
  const failed = report.status === TECHNICAL_EVIDENCE_REPORT_STATUSES.rejected;
  return {
    eventId: `technical-evidence-report:${report.id}:${report.status}`,
    sequence: 0,
    emittedAt: report.createdAt.toISOString(),
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
    toolName: ASSESSMENT_RUNTIME_SYNTHETIC_TOOL_NAMES.technicalEvidenceReport,
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

function isTerminalScanRuntimeStatus(status: string): boolean {
  return (
    status === REPOSITORY_SCAN_JOB_STATUSES.completed ||
    status === REPOSITORY_SCAN_JOB_STATUSES.failed ||
    status === REPOSITORY_SCAN_JOB_STATUSES.blocked ||
    status === REPOSITORY_SCAN_JOB_STATUSES.blockedMapping
  );
}

function isTerminalWorkerRuntimeEvent(
  eventType: AssessmentRuntimeEventType,
): boolean {
  return (
    eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.runCompleted ||
    eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.runFailed ||
    eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted ||
    eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolFailed ||
    eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolSkipped ||
    eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolWaitingInput
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
  events: AssessmentRuntimeActivityEvent[],
): AssessmentRuntimeRun[] {
  const byRunId = new Map<string, AssessmentRuntimeActivityEvent[]>();
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
      stage: latest.stage,
      status: latest.runStatus,
      activeTools: deriveActiveTools(group),
      updatedAt: latest.emittedAt,
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
  events: AssessmentRuntimeActivityEvent[],
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
        startedAt: event.startedAt,
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

function deriveLatestPostFindingStates(
  events: PersistedAssessmentRuntimeEvent[],
): AssessmentPostFindingRuntimeState[] {
  const states = new Map<string, AssessmentPostFindingRuntimeState>();
  for (const event of events) {
    if (states.has(event.assessmentId)) {
      continue;
    }
    const state = parsePostFindingRuntimeStateFromSummary(
      event.outputSummaryJson,
    );
    if (state !== null) {
      states.set(event.assessmentId, state);
    }
  }
  return Array.from(states.values());
}

function parsePostFindingRuntimeStateFromSummary(
  value: unknown,
): AssessmentPostFindingRuntimeState | null {
  const summary = objectRecord(value);
  const candidate = objectRecord(summary?.postFinding);
  if (
    candidate === null ||
    typeof candidate.assessmentId !== "string" ||
    !isPostFindingRuntimePhase(candidate.phase) ||
    !isApprovalStatus(candidate.approvalStatus)
  ) {
    return null;
  }

  return {
    assessmentId: candidate.assessmentId,
    phase: candidate.phase,
    codeReviewActivities: parsePostFindingActivities(
      candidate.codeReviewActivities,
    ),
    decisionAvailability: Array.isArray(candidate.decisionAvailability)
      ? candidate.decisionAvailability.filter(isRemediationDecision)
      : [],
    selectedDecision: isRemediationDecision(candidate.selectedDecision)
      ? candidate.selectedDecision
      : undefined,
    selectedDecisionAt:
      typeof candidate.selectedDecisionAt === "string"
        ? candidate.selectedDecisionAt
        : undefined,
    detectedPullRequest: parseRuntimePullRequest(candidate.detectedPullRequest),
    createdPullRequest: parseRuntimePullRequest(candidate.createdPullRequest),
    approvalStatus: candidate.approvalStatus,
    approvedPatchVersion:
      typeof candidate.approvedPatchVersion === "string"
        ? candidate.approvedPatchVersion
        : undefined,
    verificationActivities: parsePostFindingActivities(
      candidate.verificationActivities,
    ),
    verificationStatus: isVerificationStatus(candidate.verificationStatus)
      ? candidate.verificationStatus
      : undefined,
    finalResult: isFinalResultStatus(candidate.finalResult)
      ? candidate.finalResult
      : undefined,
    canContinueRemediation:
      typeof candidate.canContinueRemediation === "boolean"
        ? candidate.canContinueRemediation
        : undefined,
    artifacts: parsePostFindingArtifactRefs(candidate.artifacts),
  };
}

function parsePostFindingActivities(
  value: unknown,
): AssessmentPostFindingActivity[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const item = objectRecord(entry);
    if (
      item === null ||
      typeof item.id !== "string" ||
      typeof item.label !== "string" ||
      !isRunStatus(item.status)
    ) {
      return [];
    }
    return [
      {
        id: item.id,
        label: item.label,
        detail: typeof item.detail === "string" ? item.detail : undefined,
        status: item.status,
      },
    ];
  });
}

function parseRuntimePullRequest(value: unknown) {
  const item = objectRecord(value);
  if (
    item === null ||
    typeof item.number !== "number" ||
    typeof item.branch !== "string" ||
    typeof item.patchVersion !== "string"
  ) {
    return undefined;
  }
  return {
    number: item.number,
    branch: item.branch,
    patchVersion: item.patchVersion,
    url: typeof item.url === "string" ? item.url : undefined,
  };
}

function parsePostFindingArtifactRefs(value: unknown) {
  const item = objectRecord(value);
  if (item === null) {
    return undefined;
  }
  return {
    remediationPatchResourceId:
      typeof item.remediationPatchResourceId === "string"
        ? item.remediationPatchResourceId
        : undefined,
    verificationReportResourceId:
      typeof item.verificationReportResourceId === "string"
        ? item.verificationReportResourceId
        : undefined,
    finalReportResourceId:
      typeof item.finalReportResourceId === "string"
        ? item.finalReportResourceId
        : undefined,
  };
}

function isRunStatus(
  value: unknown,
): value is AssessmentPostFindingActivity["status"] {
  return (
    typeof value === "string" &&
    Object.values(ASSESSMENT_RUNTIME_RUN_STATUSES).includes(
      value as AssessmentPostFindingActivity["status"],
    )
  );
}

function isApprovalStatus(
  value: unknown,
): value is AssessmentPostFindingRuntimeState["approvalStatus"] {
  return (
    typeof value === "string" &&
    Object.values(REMEDIATION_APPROVAL_STATUSES).includes(
      value as AssessmentPostFindingRuntimeState["approvalStatus"],
    )
  );
}

function isVerificationStatus(
  value: unknown,
): value is NonNullable<
  AssessmentPostFindingRuntimeState["verificationStatus"]
> {
  return (
    typeof value === "string" &&
    Object.values(VERIFICATION_RESULT_STATUSES).includes(
      value as NonNullable<
        AssessmentPostFindingRuntimeState["verificationStatus"]
      >,
    )
  );
}

function isFinalResultStatus(
  value: unknown,
): value is NonNullable<AssessmentPostFindingRuntimeState["finalResult"]> {
  return (
    typeof value === "string" &&
    Object.values(FINAL_ASSESSMENT_RESULT_STATUSES).includes(
      value as NonNullable<AssessmentPostFindingRuntimeState["finalResult"]>,
    )
  );
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
  if (!isObject(error)) {
    return false;
  }
  if (error.code === "P2002" && isUniqueSequenceTarget(error.meta)) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.message.includes("runId_sequence_key") ||
    (error.message.includes("Unique constraint failed") &&
      error.message.includes("runId") &&
      error.message.includes("sequence"))
  );
}

function isUniqueSequenceTarget(meta: unknown): boolean {
  if (!isObject(meta)) {
    return false;
  }
  const target = meta.target;
  if (Array.isArray(target)) {
    return target.includes("runId") && target.includes("sequence");
  }
  return (
    typeof target === "string" &&
    target.includes("runId") &&
    target.includes("sequence")
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return isObject(value) ? value : null;
}

function deriveEngineeringProgress(
  events: AssessmentRuntimeActivityEvent[],
): AssessmentRuntimeEngineeringProgress[] {
  const byRun = new Map<string, AssessmentRuntimeActivityEvent[]>();
  for (const event of events) {
    if (event.stage !== ASSESSMENT_RUNTIME_STAGE_CODES.technicalEvidence) {
      continue;
    }
    const key = `${event.assessmentId}:${event.runId}`;
    byRun.set(key, [...(byRun.get(key) ?? []), event]);
  }

  return [...byRun.values()]
    .map(deriveRunEngineeringProgress)
    .filter(
      (progress): progress is AssessmentRuntimeEngineeringProgress =>
        progress !== null,
    )
    .sort((left, right) =>
      right.planningBatchId.localeCompare(left.planningBatchId),
    );
}

function deriveRunEngineeringProgress(
  runEvents: AssessmentRuntimeActivityEvent[],
): AssessmentRuntimeEngineeringProgress | null {
  const ordered = [...runEvents].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const explicitPlanner = newest(
    ordered.filter(
      (event) =>
        event.toolName ===
        ASSESSMENT_RUNTIME_ENGINEERING_PROGRESS_TOOL_NAMES.plannerSummary,
    ),
  );
  if (explicitPlanner) {
    return deriveExplicitEngineeringProgress(ordered, explicitPlanner);
  }
  return deriveApproximateEngineeringProgress(ordered);
}

function deriveExplicitEngineeringProgress(
  ordered: AssessmentRuntimeActivityEvent[],
  plannerEvent: AssessmentRuntimeActivityEvent,
): AssessmentRuntimeEngineeringProgress {
  const plannerSummary = objectRecord(plannerEvent.outputSummary) ?? {};
  const planningBatchId =
    stringValue(plannerSummary.planningBatchId) ??
    `${plannerEvent.runId}:planner:${plannerEvent.sequence}`;
  const contextRevisionUsed = numberValue(plannerSummary.contextRevisionUsed);
  const selectedCount = nonNegativeNumber(plannerSummary.selectedCount);
  const candidateCount = nonNegativeNumber(plannerSummary.candidateCount);
  const skippedCount = nonNegativeNumber(plannerSummary.skippedCount);
  const targeted = booleanValue(plannerSummary.targeted) ?? false;
  const scopedInvestigations = latestByToolName(
    ordered.filter(
      (event) =>
        event.sequence > plannerEvent.sequence &&
        event.toolName?.startsWith(
          ASSESSMENT_RUNTIME_ENGINEERING_RULE_TOOL_PREFIXES.investigator,
        ),
    ),
  );
  const investigator = investigatorCounts(scopedInvestigations, selectedCount);
  return {
    assessmentId: plannerEvent.assessmentId,
    runId: plannerEvent.runId,
    planningBatchId,
    contextRevisionUsed,
    targeted,
    approximate: false,
    planner: {
      candidateCount,
      selectedCount,
      skippedCount,
    },
    investigator,
  };
}

function deriveApproximateEngineeringProgress(
  ordered: AssessmentRuntimeActivityEvent[],
): AssessmentRuntimeEngineeringProgress | null {
  const plannerDecisions = latestByToolName(
    ordered.filter((event) =>
      event.toolName?.startsWith(
        ASSESSMENT_RUNTIME_ENGINEERING_RULE_TOOL_PREFIXES.planner,
      ),
    ),
  );
  if (plannerDecisions.length === 0) {
    return null;
  }
  const planningBatchStart = Math.min(
    ...plannerDecisions.map((event) => event.sequence),
  );
  const selectedCount = plannerDecisions.filter(
    (event) => event.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
  ).length;
  const skippedCount = plannerDecisions.filter(
    (event) => event.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolSkipped,
  ).length;
  const newestPlanner = newest(plannerDecisions) ?? plannerDecisions[0];
  const scopedInvestigations = latestByToolName(
    ordered.filter(
      (event) =>
        event.sequence > planningBatchStart &&
        event.toolName?.startsWith(
          ASSESSMENT_RUNTIME_ENGINEERING_RULE_TOOL_PREFIXES.investigator,
        ),
    ),
  );
  return {
    assessmentId: newestPlanner.assessmentId,
    runId: newestPlanner.runId,
    planningBatchId: `${newestPlanner.runId}:planner:${planningBatchStart}`,
    contextRevisionUsed: contextRevisionFromPlannerEvents(plannerDecisions),
    targeted: plannerDecisions.some(isTargetedPlannerDecision),
    approximate: true,
    planner: {
      candidateCount: plannerDecisions.length,
      selectedCount,
      skippedCount,
    },
    investigator: investigatorCounts(scopedInvestigations, selectedCount),
  };
}

function investigatorCounts(
  investigations: AssessmentRuntimeActivityEvent[],
  selectedCount: number,
): AssessmentRuntimeEngineeringProgress["investigator"] {
  const completedCount = investigations.filter(
    (event) => event.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
  ).length;
  const waitingForInputCount = investigations.filter(
    (event) =>
      event.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolWaitingInput,
  ).length;
  const failed = investigations.filter(
    (event) => event.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolFailed,
  );
  const runtimeFailedCount = failed.filter(isRuntimeFailureEvent).length;
  const domainLimitedCount = Math.max(failed.length - runtimeFailedCount, 0);
  const finishedCount =
    completedCount +
    waitingForInputCount +
    domainLimitedCount +
    runtimeFailedCount;
  return {
    selectedCount,
    completedCount,
    domainLimitedCount,
    limitedOrFailedCount: domainLimitedCount + runtimeFailedCount,
    waitingForInputCount,
    runtimeFailedCount,
    pendingCount: Math.max(selectedCount - finishedCount, 0),
  };
}

function latestByToolName(
  events: AssessmentRuntimeActivityEvent[],
): AssessmentRuntimeActivityEvent[] {
  const latest = new Map<string, AssessmentRuntimeActivityEvent>();
  for (const event of events) {
    const key = event.toolName ?? event.eventId;
    const current = latest.get(key);
    if (!current || event.sequence > current.sequence) {
      latest.set(key, event);
    }
  }
  return [...latest.values()];
}

function newest(
  events: AssessmentRuntimeActivityEvent[],
): AssessmentRuntimeActivityEvent | null {
  return events.reduce<AssessmentRuntimeActivityEvent | null>(
    (current, event) =>
      current === null || event.sequence > current.sequence ? event : current,
    null,
  );
}

function isRuntimeFailureEvent(event: AssessmentRuntimeActivityEvent): boolean {
  const summary = objectRecord(event.outputSummary);
  return summary?.failureKind === "RUNTIME_ERROR";
}

function isTargetedPlannerDecision(
  event: AssessmentRuntimeActivityEvent,
): boolean {
  const summary = objectRecord(event.outputSummary);
  const params = objectRecord(summary?.messageParams);
  return (
    summary?.reasonCode ===
      ASSESSMENT_RUNTIME_PLAN_REASON_CODES.targetedExactResumePin ||
    params?.reasonCode ===
      ASSESSMENT_RUNTIME_PLAN_REASON_CODES.targetedExactResumePin
  );
}

function contextRevisionFromPlannerEvents(
  events: AssessmentRuntimeActivityEvent[],
): number | null {
  for (const event of [...events].sort(
    (left, right) => right.sequence - left.sequence,
  )) {
    const summary = objectRecord(event.outputSummary);
    const value = numberValue(summary?.interviewContextRevisionUsed);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function nonNegativeNumber(value: unknown): number {
  return Math.max(0, Math.floor(numberValue(value) ?? 0));
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function isPersistableAgentStreamEvent(
  event: AssessmentAgentStreamEvent,
): boolean {
  return isAssessmentAgentStreamEventType(event.eventType);
}

function compareAgentStreamEvents(
  left: AssessmentAgentStreamEvent,
  right: AssessmentAgentStreamEvent,
): number {
  if (left.sequence !== right.sequence) return left.sequence - right.sequence;
  const emittedAt = left.emittedAt.localeCompare(right.emittedAt);
  if (emittedAt !== 0) return emittedAt;
  return left.eventId.localeCompare(right.eventId);
}

function normalizeAssessmentStreamScope(
  assessmentId: string | null | undefined,
): string | null {
  if (assessmentId === null || assessmentId === undefined) {
    return null;
  }
  return (
    sanitizeAgentStreamIdentifier(assessmentId) ??
    INVALID_ASSESSMENT_STREAM_SCOPE
  );
}

function nonAgentStreamJournalWhere(where?: Record<string, unknown>) {
  const nonJournal = { NOT: { toolName: AGENT_STREAM_JOURNAL_TOOL_NAME } };
  return where ? { AND: [where, nonJournal] } : nonJournal;
}

function durableReplayLimitForAssessment(
  index: number,
  assessmentCount: number,
): number {
  if (assessmentCount <= 0) return 0;
  const eligibleAssessmentCount = Math.min(
    assessmentCount,
    AGENT_STREAM_DURABLE_REPLAY_TOTAL_LIMIT,
  );
  const baseLimit = Math.floor(
    AGENT_STREAM_DURABLE_REPLAY_TOTAL_LIMIT / eligibleAssessmentCount,
  );
  const remainder =
    AGENT_STREAM_DURABLE_REPLAY_TOTAL_LIMIT % eligibleAssessmentCount;
  return baseLimit + (index < remainder ? 1 : 0);
}

type AgentStreamHistoryCursor = {
  createdAt: Date;
  sequence: number;
  id: string;
};

function normalizeAgentStreamHistoryLimit(limit: number | null | undefined) {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return AGENT_STREAM_HISTORY_DEFAULT_LIMIT;
  }
  return Math.min(
    AGENT_STREAM_HISTORY_MAX_LIMIT,
    Math.max(1, Math.floor(limit)),
  );
}

function encodeAgentStreamHistoryCursor(
  row: PersistedAssessmentRuntimeEvent,
): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: row.createdAt.toISOString(),
      sequence: row.sequence,
      id: row.id,
    }),
  ).toString("base64url");
}

function decodeAgentStreamHistoryCursor(
  cursor: string | null | undefined,
): AgentStreamHistoryCursor | null {
  if (!cursor?.trim()) return null;
  try {
    const decoded = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const createdAt =
      typeof decoded.createdAt === "string"
        ? new Date(decoded.createdAt)
        : null;
    const sequence = numberValue(decoded.sequence);
    const id = stringValue(decoded.id);
    if (
      createdAt === null ||
      Number.isNaN(createdAt.getTime()) ||
      sequence === null ||
      id === null
    ) {
      return null;
    }
    return { createdAt, sequence, id };
  } catch {
    return null;
  }
}

function agentStreamHistoryCursorWhere(cursor: AgentStreamHistoryCursor) {
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      {
        AND: [
          { createdAt: cursor.createdAt },
          { sequence: { lt: cursor.sequence } },
        ],
      },
      {
        AND: [
          { createdAt: cursor.createdAt },
          { sequence: cursor.sequence },
          { id: { lt: cursor.id } },
        ],
      },
    ],
  };
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function createBoundedAgentStreamEventDedupe(
  maxSeen: number,
): (event: AssessmentAgentStreamEvent) => boolean {
  const seen = new Set<string>();
  const orderedIds: string[] = [];
  const limit = Math.max(1, maxSeen);
  return (event) => {
    if (seen.has(event.eventId)) {
      return false;
    }
    seen.add(event.eventId);
    orderedIds.push(event.eventId);
    while (orderedIds.length > limit) {
      const expiredId = orderedIds.shift();
      if (expiredId) {
        seen.delete(expiredId);
      }
    }
    return true;
  };
}

function agentStreamJournalSummary(event: AssessmentAgentStreamEvent): string {
  const data = objectRecord(event.data);
  const name =
    event.toolName ??
    stringValue(data?.toolName) ??
    stringValue(data?.skillName) ??
    stringValue(data?.model) ??
    event.nodeName ??
    event.agentName ??
    "runtime";
  return `Agent stream ${event.eventType} ${name}`;
}

function agentStreamJournalEventFromRow(
  row: PersistedAssessmentRuntimeEvent,
): AssessmentAgentStreamEvent | null {
  const output = objectRecord(row.outputSummaryJson);
  const event = objectRecord(output?.agentStreamEvent);
  if (event === null) return null;
  const data = isRuntimeSummaryValue(event.data) ? event.data : null;
  const candidate: AssessmentAgentStreamEvent = {
    eventId: stringValue(event.eventId) ?? row.id,
    sequence: numberValue(event.sequence) ?? row.sequence,
    clientSequence: numberValue(event.clientSequence),
    emittedAt: stringValue(event.emittedAt) ?? row.createdAt.toISOString(),
    assessmentId: stringValue(event.assessmentId) ?? row.assessmentId,
    runId: stringValue(event.runId) ?? row.runId,
    correlationId: stringValue(event.correlationId) ?? row.correlationId,
    eventType: event.eventType as AssessmentAgentStreamEventType,
    source: stringValue(event.source),
    agentName: stringValue(event.agentName),
    subagentName: stringValue(event.subagentName),
    namespace: Array.isArray(event.namespace)
      ? event.namespace.flatMap((item) => {
          const value = stringValue(item);
          return value === null ? [] : [value];
        })
      : [],
    nodeName: stringValue(event.nodeName),
    messageId: stringValue(event.messageId),
    toolName: stringValue(event.toolName),
    toolCallId: stringValue(event.toolCallId),
    status: stringValue(event.status),
    text: stringValue(event.text),
    data,
  };
  return isPersistableAgentStreamEvent(candidate) ? candidate : null;
}

function isRuntimeSummaryValue(
  value: unknown,
): value is AssessmentRuntimeSummaryValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isRuntimeSummaryValue);
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every(
      isRuntimeSummaryValue,
    );
  }
  return false;
}

async function delayRuntimeEventSequenceRetry(index: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, RUNTIME_EVENT_SEQUENCE_RETRY_DELAY_MS * (index + 1));
  });
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
