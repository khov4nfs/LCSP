import {
  ASSESSMENT_RUNTIME_EVENT_TYPES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  type AssessmentRuntimeEventType,
  type AssessmentRuntimeActiveTool,
  type AssessmentRuntimeActivityEvent,
  type AssessmentRuntimeRun,
  type AssessmentRuntimeRunStatus,
  type AssessmentRuntimeSnapshot,
  type AssessmentRuntimeStageCode,
  type AssessmentRuntimeSummaryValue,
} from "@lcsp/contracts/evidence";
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

@Injectable()
export class AssessmentRuntimeEventService {
  private readonly logger = new Logger(AssessmentRuntimeEventService.name);

  constructor(private readonly prisma: PrismaService) {}

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

  async recordToolStarted(
    input: Omit<RecordRuntimeEventInput, "eventType" | "runStatus">,
  ): Promise<void> {
    await this.recordEvent({
      ...input,
      eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolStarted,
      runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
    });
  }

  async recordToolCompleted(
    input: Omit<RecordRuntimeEventInput, "eventType" | "runStatus">,
  ): Promise<void> {
    await this.recordEvent({
      ...input,
      eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
      runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.waiting,
    });
  }

  async recordToolWaitingInput(
    input: Omit<RecordRuntimeEventInput, "eventType" | "runStatus">,
  ): Promise<void> {
    await this.recordEvent({
      ...input,
      eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolWaitingInput,
      runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.waiting,
    });
  }

  async recordToolFailed(
    input: Omit<RecordRuntimeEventInput, "eventType" | "runStatus">,
  ): Promise<void> {
    await this.recordEvent({
      ...input,
      eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolFailed,
      runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.failed,
    });
  }

  async buildWorkspaceSnapshot(
    organizationId: string,
  ): Promise<AssessmentRuntimeSnapshot> {
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

    const recentActivity = events
      .slice(0, 50)
      .map((event) => this.toActivityEvent(event));
    const runs = deriveRuns(events).slice(0, 20);

    return {
      emittedAt: new Date().toISOString(),
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

  private logRuntimeEventTableMissing(operation: string, error: unknown) {
    this.logger.warn(
      `AssessmentRuntimeEvent table missing during ${operation}; returning empty runtime activity until migration 20260813235900_add_assessment_runtime_event is applied.`,
    );
    if (error instanceof Error) {
      this.logger.debug(error.message);
    }
  }
}

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

function toJsonOrNull(
  value: AssessmentRuntimeSummaryValue | null,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | null {
  if (value === null) {
    return null;
  }
  return value;
}

function isUniqueSequenceViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes("runId_sequence_key");
}

function isMissingAssessmentRuntimeEventTable(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("AssessmentRuntimeEvent") &&
    (error.message.includes("does not exist") ||
      error.message.includes("does not exist in the current database"))
  );
}

export function summarizeFailure(error: unknown): string {
  return summarizeRuntimeError(error);
}

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
