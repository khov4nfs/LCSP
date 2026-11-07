import {
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import { ASSESSMENT_SESSION_DURATION_MEASUREMENTS } from "@lcsp/contracts/assessment-domain";
import { LLM_USAGE_STATUSES } from "@lcsp/contracts/billing";
import {
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES,
  isAssessmentAgentStreamEventType,
  type AssessmentAgentStreamEventType,
} from "@lcsp/contracts/evidence";
import { asRecord } from "@lcsp/contracts/shared/type-guards";

type SessionTurnObservation = {
  id?: string;
  logicalRunId?: string;
  threadId?: string;
  state?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

type SessionLifecycleObservation = {
  eventType?: string;
  payload?: unknown;
  timestamp?: unknown;
};

type SessionAssessmentClock = {
  runtime?: { startedAt?: unknown } | null;
  lifecycleState?: string | null;
  updatedAt?: unknown;
};

type SessionTokenMeasurements = {
  inputTokens?: unknown;
  outputTokens?: unknown;
  totalTokens?: unknown;
  cachedInputTokens?: unknown;
  reasoningTokens?: unknown;
};

type SessionTokenObservation = SessionTokenMeasurements & {
  status?: unknown;
};

type SessionJournalObservation = {
  runId?: string | null;
  sequence?: number;
  toolName?: string | null;
  outputSummaryJson?: unknown;
  durationMs?: number | null;
};

type SessionToolExecution = {
  runId: SessionJournalObservation["runId"];
  sequence: SessionJournalObservation["sequence"];
  eventType: AssessmentAgentStreamEventType;
  toolCallId: string | null;
  toolName: string | null;
  durationMs: number | null;
  status: string | null;
};

/**
 * Business purpose: Read a persisted timestamp without treating missing or invalid data as an epoch measurement.
 * Business rules: Only a finite Date or nonempty timestamp string is measurable.
 * Execution flow: Validate the input shape, parse the timestamp and return its finite milliseconds.
 * Failure cases: Missing, malformed or unsupported values return null.
 * Side effects: None; this is a pure conversion.
 */
function timestampOrNull(value: unknown): number | null {
  if (!(value instanceof Date) && (typeof value !== "string" || !value.trim()))
    return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Business purpose: Export observed turn spans and canonical wall duration without certifying active execution time.
 * Business rules:
 * - Turn updatedAt records persistence activity, not an authoritative RUNNING-state boundary.
 * - Active duration remains unavailable; observed turn spans may include waits or overlap.
 * - Wall duration requires a recorded COMPLETE transition and never substitutes assessment updatedAt.
 * Execution flow:
 * 1. Read the earliest valid turn start, with runtime start only as a fallback.
 * 2. Find the canonical completion timestamp and retain each turn's original timestamps/state.
 * 3. Sum valid nonnegative spans and attach explicit measurement coverage.
 * Failure cases: Missing, reversed or malformed timestamps remain unmeasured rather than becoming zero.
 * Side effects: Pure calculation; no assessment state or persisted records change.
 */
export function summarizeSessionDurations(
  turns: readonly SessionTurnObservation[],
  events: readonly SessionLifecycleObservation[],
  assessment: SessionAssessmentClock | null,
) {
  const starts = turns
    .map((turn) => timestampOrNull(turn.createdAt))
    .filter((value): value is number => value !== null);
  const startedAtMs = starts.length
    ? Math.min(...starts)
    : timestampOrNull(assessment?.runtime?.startedAt);
  const completeEvent = events?.find(
    (event) =>
      event.eventType ===
        AGENTIC_ASSESSMENT_EVENT_TYPES.ASSESSMENT_LIFECYCLE_CHANGED &&
      asRecord(event.payload)?.toState === ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
  );
  const completedAtMs = timestampOrNull(completeEvent?.timestamp);
  const wallDurationMs =
    startedAtMs !== null &&
    completedAtMs !== null &&
    completedAtMs >= startedAtMs
      ? completedAtMs - startedAtMs
      : null;

  let measuredTurnSpans = 0;
  let spanTotal = 0;
  const executionSegments = turns.map((turn) => {
    const start = timestampOrNull(turn.createdAt);
    const end = timestampOrNull(turn.updatedAt);
    const durationMs =
      start !== null && end !== null && end >= start ? end - start : null;
    if (durationMs !== null) {
      measuredTurnSpans++;
      spanTotal += durationMs;
    }
    return {
      id: turn.id,
      logicalRunId: turn.logicalRunId,
      threadId: turn.threadId,
      state: turn.state,
      startedAt: turn.createdAt,
      completedAt: turn.updatedAt,
      durationMs,
    };
  });

  return {
    startedAt:
      startedAtMs === null ? null : new Date(startedAtMs).toISOString(),
    completedAt:
      completedAtMs === null ? null : new Date(completedAtMs).toISOString(),
    wallDurationMs,
    activeDurationMs: null,
    // Compatibility field: sum of observed turn spans, not certified active time.
    observedRunningDurationMs: measuredTurnSpans ? spanTotal : null,
    durationMeasurement: measuredTurnSpans
      ? ASSESSMENT_SESSION_DURATION_MEASUREMENTS.OBSERVED_TURN_SPANS
      : wallDurationMs !== null
        ? ASSESSMENT_SESSION_DURATION_MEASUREMENTS.WALL_ONLY
        : ASSESSMENT_SESSION_DURATION_MEASUREMENTS.UNAVAILABLE,
    durationCoverage: {
      activeDurationAuthoritative: false,
      totalTurns: turns.length,
      measuredTurnSpans,
      invalidOrMissingTurnSpans: turns.length - measuredTurnSpans,
      mayIncludeWaitsAndOverlaps: true,
    },
    executionSegments,
  };
}

/**
 * Business purpose: Sum one provider token dimension while preserving missing measurements and numeric safety.
 * Business rules:
 * - Only nonnegative safe integers reported on SETTLED rows contribute to the observed sum.
 * - A complete total requires a measurement for every usage row; measured zero remains valid.
 * - Unsafe integers or an overflowing sum cannot be published as an exact total.
 * Execution flow: Inspect each row, count measured/missing/invalid values, then derive complete and partial totals.
 * Failure cases: Missing status/data, unavailable usage or overflow leaves the complete total null.
 * Side effects: None; persisted provider records are neither changed nor inferred.
 */
function summarizeTokenMetric(
  usages: readonly SessionTokenObservation[],
  field: keyof SessionTokenMeasurements,
) {
  let reportedEvents = 0;
  let invalidEvents = 0;
  let total = 0;
  let overflow = false;
  for (const usage of usages) {
    if (usage.status !== LLM_USAGE_STATUSES.SETTLED || usage[field] == null)
      continue;
    const raw = usage[field];
    if (
      (typeof raw !== "number" && typeof raw !== "bigint") ||
      !Number.isSafeInteger(Number(raw)) ||
      Number(raw) < 0
    ) {
      invalidEvents++;
      continue;
    }
    reportedEvents++;
    total += Number(raw);
    if (!Number.isSafeInteger(total)) overflow = true;
  }
  const observedTotal = reportedEvents > 0 && !overflow ? total : null;
  const exhaustive =
    usages.length > 0 && reportedEvents === usages.length && !overflow;
  return {
    total: exhaustive ? observedTotal : null,
    observedTotal,
    coverage: {
      exhaustive,
      reportedEvents,
      missingEvents: usages.length - reportedEvents - invalidEvents,
      invalidEvents,
      overflow,
    },
  };
}

/**
 * Business purpose: Export measured provider token totals with independent completeness for every dimension.
 * Business rules:
 * - Unknown measurements stay null; zero is exported only when providers measured zero.
 * - Partial sums are explicit observed totals, not complete session consumption.
 * - Cached/reasoning dimensions remain separate and are never added to another reported total.
 * Execution flow: Summarize each persisted token dimension and return complete totals plus partial coverage.
 * Failure cases: Empty, unavailable, partially measured or unsafe values remain incomplete.
 * Side effects: Pure reduction; does not change billing, usage records or assessment state.
 */
export function summarizeSessionTokenUsage(
  usages: readonly SessionTokenObservation[] | null | undefined,
) {
  const rows = usages ?? [];
  const input = summarizeTokenMetric(rows, "inputTokens");
  const output = summarizeTokenMetric(rows, "outputTokens");
  const total = summarizeTokenMetric(rows, "totalTokens");
  const cached = summarizeTokenMetric(rows, "cachedInputTokens");
  const reasoning = summarizeTokenMetric(rows, "reasoningTokens");
  const metrics = {
    inputTokens: input.coverage,
    outputTokens: output.coverage,
    totalTokens: total.coverage,
    cachedTokens: cached.coverage,
    reasoningTokens: reasoning.coverage,
  };
  return {
    inputTokens: input.total,
    outputTokens: output.total,
    totalTokens: total.total,
    cachedTokens: cached.total,
    reasoningTokens: reasoning.total,
    observedTotals: {
      inputTokens: input.observedTotal,
      outputTokens: output.observedTotal,
      totalTokens: total.observedTotal,
      cachedTokens: cached.observedTotal,
      reasoningTokens: reasoning.observedTotal,
      coverage: {
        exhaustive: Object.values(metrics).every((metric) => metric.exhaustive),
        eventsCount: rows.length,
        settledEvents: rows.filter(
          (row) => row.status === LLM_USAGE_STATUSES.SETTLED,
        ).length,
        metrics,
      },
    },
  };
}

/**
 * Business purpose: Count identifiable semantic tool calls without treating every journal row as a tool or model invocation.
 * Business rules:
 * - Only persisted semantic TOOL_CALL/RESULT events with a run and toolCallId identify a call.
 * - Call/result/replay rows for the same identity count once; missing identities remain explicit.
 * - Generic journal rows and model events cannot establish a complete invocation count.
 * Execution flow: Read the persisted agentStreamEvent envelope, collect known tool identities and retain observed events.
 * Failure cases: Unclassified or incomplete rows remain in raw history and coverage, never fabricated calls or successes.
 * Side effects: Pure aggregation; tool arguments are not copied into the summary.
 */
export function summarizeSessionTools(
  journal: readonly SessionJournalObservation[] | null | undefined,
) {
  const rows = journal ?? [];
  const toolTypes = new Set<string>([
    ASSESSMENT_AGENT_STREAM_EVENT_TYPES.semanticToolCall,
    ASSESSMENT_AGENT_STREAM_EVENT_TYPES.semanticToolResult,
    ASSESSMENT_AGENT_STREAM_EVENT_TYPES.toolResult,
  ]);
  const modelTypes = new Set<string>([
    ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelRequest,
    ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelResult,
    ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallStarted,
    ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallCompleted,
    ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallCancelled,
    ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallFailed,
    ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallTimeout,
  ]);
  const toolExecutions: SessionToolExecution[] = [];
  const identities = new Set<string>();
  let unidentifiedToolEvents = 0;
  let unclassifiedJournalRows = 0;
  let observedModelEvents = 0;
  for (const row of rows) {
    const event = asRecord(asRecord(row.outputSummaryJson)?.agentStreamEvent);
    if (!event || !isAssessmentAgentStreamEventType(event.eventType)) {
      unclassifiedJournalRows++;
      continue;
    }
    if (modelTypes.has(event.eventType)) observedModelEvents++;
    if (!toolTypes.has(event.eventType)) continue;
    const toolCallId =
      typeof event.toolCallId === "string" && event.toolCallId.trim()
        ? event.toolCallId
        : null;
    if (toolCallId && typeof row.runId === "string" && row.runId.trim()) {
      identities.add(JSON.stringify([row.runId, toolCallId]));
    } else {
      unidentifiedToolEvents++;
    }
    toolExecutions.push({
      runId: row.runId,
      sequence: row.sequence,
      eventType: event.eventType,
      toolCallId,
      toolName: typeof event.toolName === "string" ? event.toolName : null,
      durationMs: row.durationMs ?? null,
      status: typeof event.status === "string" ? event.status : null,
    });
  }
  return {
    modelCalls: null,
    modelCallCoverage: { exhaustive: false, observedModelEvents },
    toolCalls: identities.size,
    toolCallCoverage: {
      exhaustive: false,
      identifiedCalls: identities.size,
      observedToolEvents: toolExecutions.length,
      unidentifiedToolEvents,
      unclassifiedJournalRows,
    },
    toolExecutions,
  };
}
