import type { AssessmentEvent } from "@lcsp/contracts/assessment";
import {
  AGENT_STREAM_BOUNDARY_TYPES,
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES,
  isAssessmentAgentStreamEventType,
  type AssessmentAgentStreamEvent,
  type AssessmentAgentStreamEventType,
  type AgentStreamBoundaryType,
  type AssessmentRuntimeSnapshot,
  type AssessmentRuntimeSummaryValue,
  type CanonicalAssessmentRuntimeSnapshot,
} from "@lcsp/contracts/evidence";
import { asRecord } from "@lcsp/contracts/shared";
import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
  defer,
  filter,
  from,
  map,
  merge,
  mergeMap,
  Observable,
  ReplaySubject,
} from "rxjs";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import {
  CANONICAL_EVENT_SELECT,
  toAssessmentEvent,
} from "./canonical-assessment-event.mapper.js";
import {
  projectCanonicalAssessment,
  type PersistedCanonicalAssessmentRow,
} from "./canonical-assessment-projection.js";
import {
  sanitizeAgentStreamIdentifier,
  sanitizeAgentStreamText,
  sanitizeAgentStreamValue,
} from "./agent-stream-sanitizer.js";
import {
  FALLBACK_SUMMARY,
  sanitizeRuntimeSummaryText,
  sanitizeRuntimeSummaryValue,
} from "./runtime-summary-sanitizer.js";

const RUNTIME_EVENT_SEQUENCE_RETRY_ATTEMPTS = 8;
const RUNTIME_EVENT_SEQUENCE_RETRY_DELAY_MS = 5;
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
  assessmentId?: string | null;
  boundaryType?: AgentStreamBoundaryType | null;
  boundaryId?: string | null;
  preparationRunId?: string | null;
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
  idempotentId?: string;
  assessmentId?: string | null;
  boundaryType: AgentStreamBoundaryType;
  boundaryId: string;
  preparationRunId?: string | null;
  runId: string;
  correlationId: string;
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

type PersistedAssessmentRuntimeEvent = {
  id: string;
  assessmentId: string | null;
  boundaryType: AgentStreamBoundaryType;
  boundaryId: string;
  preparationRunId: string | null;
  runId: string;
  correlationId: string;
  sequence: number;
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

type OwnedAssessmentAgentStreamEvent = {
  ownerId: string;
  event: AssessmentAgentStreamEvent;
};

type ObserveAgentStreamEventsOptions = {
  assessmentId?: string | null;
  preparationRunId?: string | null;
};

export type AgentStreamHistoryPage = {
  events: AssessmentAgentStreamEvent[];
  nextCursor: string | null;
  hasMore: boolean;
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
   * @param prisma - Prisma service used to persist and read canonical runtime activity.
   */
  constructor(private readonly prisma: PrismaService) {}

  /** Publish one redacted, bounded live event to connected workspace clients. */
  async publishAgentStreamEvent(
    input: PublishAgentStreamEventInput,
    existingTx?: Prisma.TransactionClient,
  ): Promise<AssessmentAgentStreamEvent | null> {
    const assessmentId = sanitizeAgentStreamIdentifier(input.assessmentId);
    const preparationRunId = sanitizeAgentStreamIdentifier(
      input.preparationRunId,
    );
    const boundaryType: AgentStreamBoundaryType =
      input.boundaryType ??
      (preparationRunId
        ? AGENT_STREAM_BOUNDARY_TYPES.ruleSetPreparation
        : AGENT_STREAM_BOUNDARY_TYPES.assessment);
    const boundaryId =
      sanitizeAgentStreamIdentifier(input.boundaryId) ??
      preparationRunId ??
      assessmentId;
    if (boundaryId === null) {
      this.logger.warn("Agent stream event ignored without boundary identity");
      return null;
    }
    const ownerId = assessmentId
      ? await this.resolveAssessmentOwnerId(assessmentId)
      : preparationRunId
        ? `preparation:${preparationRunId}`
        : null;
    if (ownerId === null) {
      this.logger.warn(
        `Agent stream event ignored for unknown stream boundary ${boundaryId}`,
      );
      return null;
    }
    const event: AssessmentAgentStreamEvent = {
      eventId: sanitizeAgentStreamIdentifier(input.eventId) ?? randomUUID(),
      sequence: this.nextAgentStreamSequence(),
      clientSequence: input.clientSequence ?? null,
      emittedAt: new Date().toISOString(),
      assessmentId,
      boundaryType,
      boundaryId,
      preparationRunId,
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
      data: sanitizeAgentStreamValue(
        input.data,
        0,
        false,
        input.eventType ===
          ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallCompleted,
      ),
    };
    if (isPersistableAgentStreamEvent(event)) {
      await this.persistAgentStreamJournalEvent(event, existingTx);
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
    const preparationRunId = normalizeAssessmentStreamScope(
      options?.preparationRunId,
    );
    return merge(
      defer(() =>
        from(
          this.getDurableAgentStreamEvents(
            ownerId,
            assessmentId,
            preparationRunId,
          ),
        ).pipe(mergeMap((events) => from(events))),
      ),
      this.agentStreamEvents.pipe(
        filter(
          (entry) =>
            entry.ownerId === ownerId &&
            (assessmentId === null ||
              entry.event.assessmentId === assessmentId) &&
            (preparationRunId === null ||
              entry.event.preparationRunId === preparationRunId),
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
    existingTx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.recordEvent(
      {
        ...([
          ASSESSMENT_AGENT_STREAM_EVENT_TYPES.runtimeResumed,
          ASSESSMENT_AGENT_STREAM_EVENT_TYPES.runtimeStopRequested,
          ASSESSMENT_AGENT_STREAM_EVENT_TYPES.runtimeStopped,
          ASSESSMENT_AGENT_STREAM_EVENT_TYPES.runtimeResumeRequested,
          ASSESSMENT_AGENT_STREAM_EVENT_TYPES.runtimeCompleted,
        ].includes(event.eventType as never)
          ? {
              idempotentId: `runtime-control:${event.assessmentId}:${event.eventId}`,
            }
          : {}),
        assessmentId: event.assessmentId,
        boundaryType: event.boundaryType,
        boundaryId: event.boundaryId,
        preparationRunId: event.preparationRunId,
        runId: event.runId,
        correlationId: event.correlationId,
        toolName: AGENT_STREAM_JOURNAL_TOOL_NAME,
        summary: agentStreamJournalSummary(event),
        outputSummary: {
          agentStreamEvent: event,
          semanticPayloads: event.data === null ? [] : [event.data],
        },
        summaryMaxDepth: 8,
        summaryMaxItems: 100,
      },
      existingTx,
    );
  }

  private async getDurableAgentStreamEvents(
    ownerId: string,
    assessmentId: string | null = null,
    preparationRunId: string | null = null,
  ): Promise<AssessmentAgentStreamEvent[]> {
    if (preparationRunId !== null) {
      const rows = await this.findMany({
        where: {
          preparationRunId,
          toolName: AGENT_STREAM_JOURNAL_TOOL_NAME,
        },
        orderBy: [{ createdAt: "asc" }, { sequence: "asc" }],
        take: AGENT_STREAM_DURABLE_REPLAY_TOTAL_LIMIT,
      });
      return rows.flatMap((row) => {
        const event = agentStreamJournalEventFromRow(row);
        return event === null ? [] : [event];
      });
    }
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
        this.findMany({
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
    const rows = await this.findMany({
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
   * Builds the workspace runtime snapshot from persisted runtime activity.
   *
   * @returns Snapshot containing recent activity and runtime journal summaries.
   */
  async buildWorkspaceSnapshot(
    ownerId?: string,
    correlationId = "",
    preparationRunId?: string | null,
  ): Promise<AssessmentRuntimeSnapshot> {
    const [canonicalAssessments, canonicalEvents, agentStreamEvents] =
      await Promise.all([
        this.readCanonicalAssessments(ownerId, correlationId),
        this.readCanonicalEvents(ownerId),
        preparationRunId
          ? this.getDurableAgentStreamEvents(
              `preparation:${preparationRunId}`,
              null,
              preparationRunId,
            )
          : Promise.resolve([]),
      ]);
    return {
      emittedAt: new Date().toISOString(),
      canonicalAssessments,
      canonicalEvents,
      agentStreamEvents,
    };
  }

  /** Reads only canonical ALS/AES rows; absent migrated rows remain unavailable. */
  private async readCanonicalAssessments(
    ownerId?: string,
    correlationId = "",
  ): Promise<CanonicalAssessmentRuntimeSnapshot[]> {
    const rows = await this.prisma.assessment.findMany({
      where: ownerId ? { ownerId } : undefined,
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: {
        id: true,
        lifecycleState: true,
        lifecycleRevision: true,
        blockerReason: true,
        blockerReference: true,
        runtime: {
          select: {
            threadId: true,
            rootAgentVersion: true,
            checkpointNamespace: true,
            checkpointId: true,
            currentExecutionId: true,
            executionState: true,
            eventSequence: true,
            startedAt: true,
            lastResumedAt: true,
            updatedAt: true,
          },
        },
      },
    });
    return rows.map((row) =>
      projectCanonicalAssessment(
        row.id,
        row as PersistedCanonicalAssessmentRow,
        correlationId,
      ),
    );
  }

  /** Canonical event history for SSE; activity projections remain secondary. */
  private async readCanonicalEvents(
    ownerId?: string,
  ): Promise<AssessmentEvent[]> {
    const rows = await this.prisma.assessmentEvent.findMany({
      where: ownerId ? { assessment: { ownerId } } : undefined,
      orderBy: [{ timestamp: "desc" }, { sequence: "desc" }],
      take: 200,
      select: CANONICAL_EVENT_SELECT,
    });
    return rows.map(toAssessmentEvent);
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
          ...(input.idempotentId ? { id: input.idempotentId } : {}),
          assessmentId: input.assessmentId ?? null,
          boundaryType: input.boundaryType,
          boundaryId: input.boundaryId,
          preparationRunId: input.preparationRunId ?? null,
          runId: input.runId,
          correlationId: input.correlationId,
          sequence: (latest?.sequence ?? 0) + 1,
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
        if (
          input.idempotentId &&
          asRecord(error)?.code === "P2002" &&
          (await runtimeEventDelegate(this.prisma).findFirst({
            where: { id: input.idempotentId },
          }))
        ) {
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

  private async findMany(args: Record<string, unknown>) {
    return (await runtimeEventDelegate(this.prisma).findMany(
      args,
    )) as PersistedAssessmentRuntimeEvent[];
  }
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

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
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
    boundaryType:
      (stringValue(event.boundaryType) as AgentStreamBoundaryType | null) ??
      row.boundaryType ??
      AGENT_STREAM_BOUNDARY_TYPES.assessment,
    boundaryId:
      stringValue(event.boundaryId) ??
      row.boundaryId ??
      row.assessmentId ??
      row.runId,
    preparationRunId:
      stringValue(event.preparationRunId) ?? row.preparationRunId,
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
