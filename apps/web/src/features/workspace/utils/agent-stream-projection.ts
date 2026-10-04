import {
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES,
  ASSESSMENT_AGENT_STREAM_SCHEMA_VERSIONS,
  ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  type AssessmentAgentStreamEvent,
  type AssessmentRuntimeSummaryValue,
} from "@lcsp/contracts/evidence";
import { resolveMessage } from "@lcsp/i18n";
import { appLocale } from "@/lib/locale";
import type { AgentStreamRuleHeader } from "../types/agent-stream-rule.types";
import type { StreamRowUsage } from "../types/agent-stream-usage.types";
import type { WorkspaceRuntimeAgentStreamHistoryState } from "../types/workspace-runtime.types";
import { modelTurnUsage, toolCallMetrics } from "./agent-stream-usage";
import { agentStreamTurnKey } from "./agent-stream-identity";
import {
  isAgentStreamRuleLifecycleEvent,
  projectAgentStreamRuleHeaders,
} from "./agent-stream-rule-groups";

export const AGENT_STREAM_RUN_OUTCOMES = {
  running: "running",
  completed: "completed",
  failed: "failed",
  paused: "paused",
} as const;

export type AgentStreamRunOutcome =
  (typeof AGENT_STREAM_RUN_OUTCOMES)[keyof typeof AGENT_STREAM_RUN_OUTCOMES];

export const STREAM_ROW_KINDS = {
  tool: "tool",
  reasoning: "reasoning",
  model: "model",
  progress: "progress",
  log: "log",
  activity: "activity",
} as const;

export type StreamRowKind =
  (typeof STREAM_ROW_KINDS)[keyof typeof STREAM_ROW_KINDS];

export const STREAM_ROW_STATUSES = {
  running: "running",
  completed: "completed",
  failed: "failed",
  neutral: "neutral",
} as const;

export type StreamRowStatus =
  (typeof STREAM_ROW_STATUSES)[keyof typeof STREAM_ROW_STATUSES];

export type ProjectedStreamRow = {
  dispatchKey: string;
  id: string;
  runId: string;
  ruleId: string | null;
  /** Sequence of the event that opened this row; keeps its place when updated. */
  firstSequence: number;
  sequence: number;
  label: string;
  detail: string | null;
  meta: string | null;
  failed: boolean;
  kind: StreamRowKind;
  status: StreamRowStatus;
  input: AssessmentRuntimeSummaryValue | null;
  output: AssessmentRuntimeSummaryValue | null;
  technical: AssessmentRuntimeSummaryValue | null;
  /** What the tool call acts on (file, pattern, command), shown inline. */
  target: string | null;
  /** Tool activity used to pick its icon. */
  activity: StreamActivityKey | null;
  scope: string;
  /** Model rows only: provider tries folded into this one logical turn. */
  providerAttempts?: number;
  /** Provider-reported usage (model) or tool result size (tool); absent when unreported. */
  usage?: StreamRowUsage;
  completedTurns?: ProjectedStreamRow[];
};

export type StreamActivityKey = keyof ReturnType<typeof streamActivityLabels>;

export function deriveAgentStreamRunOutcome(
  events: AssessmentAgentStreamEvent[],
): AgentStreamRunOutcome {
  const runIsActive = hasOpenBoundary(events);
  const rows = groupRepeatedActivities(projectStreamRows(events));
  const ruleHeaders = finalizeRuleHeaders(
    projectAgentStreamRuleHeaders(events),
    events,
  );
  const hasRunningActivity =
    runIsActive ||
    rows.some((row) => row.status === "running") ||
    [...ruleHeaders.values()].some(
      (header) => header.status === ASSESSMENT_RUNTIME_RUN_STATUSES.running,
    );
  if (hasRunningActivity) return AGENT_STREAM_RUN_OUTCOMES.running;
  const latestEvent = events.at(-1);
  const paused =
    latestEvent !== undefined &&
    terminalOutcomesByRun(events).get(dispatchKey(latestEvent)) ===
      TERMINAL_OUTCOMES.paused;
  if (paused) return AGENT_STREAM_RUN_OUTCOMES.paused;
  if (streamEndedWithFailure(events)) return AGENT_STREAM_RUN_OUTCOMES.failed;
  return AGENT_STREAM_RUN_OUTCOMES.completed;
}

export function shouldShowAgentStreamHistoryAction(
  history: WorkspaceRuntimeAgentStreamHistoryState | undefined,
  onLoadOlder: (() => void) | undefined,
): boolean {
  return (
    ((history?.hasMore === true && history.nextCursor !== null) ||
      history?.error != null) &&
    onLoadOlder !== undefined
  );
}

export function scopeAgentStreamRunEvents(
  events: AssessmentAgentStreamEvent[],
  activeRunId: string | null,
): AssessmentAgentStreamEvent[] {
  if (activeRunId) {
    return events.filter((event) => event.runId === activeRunId);
  }
  return latestAgentStreamRunEvents(events);
}

export function latestAgentStreamRunEvents(
  events: AssessmentAgentStreamEvent[],
): AssessmentAgentStreamEvent[] {
  if (events.length === 0) return events;

  const latest = events.reduce((current, candidate) => {
    const emittedAt = candidate.emittedAt.localeCompare(current.emittedAt);
    if (emittedAt > 0) return candidate;
    if (emittedAt < 0) return current;
    if (
      candidate.runId === current.runId &&
      candidate.sequence > current.sequence
    ) {
      return candidate;
    }
    if (
      candidate.runId !== current.runId &&
      candidate.eventId > current.eventId
    ) {
      return candidate;
    }
    return current;
  });

  return events.filter((event) => event.runId === latest.runId);
}

/**
 * Credential rotation and provider fallback are infrastructure routing details.
 * New runs no longer publish them; historical streams still contain them, so they
 * are dropped from the activity projection and raw counts instead of rewritten.
 */
export function withoutRoutingEvents(
  events: AssessmentAgentStreamEvent[],
): AssessmentAgentStreamEvent[] {
  return events.filter(
    (event) =>
      event.eventType !== ASSESSMENT_AGENT_STREAM_EVENT_TYPES.credentialRotation &&
      event.eventType !== ASSESSMENT_AGENT_STREAM_EVENT_TYPES.providerFallback,
  );
}

export function projectStreamRows(
  events: AssessmentAgentStreamEvent[],
): ProjectedStreamRow[] {
  const sorted = [...events].sort(
    (left, right) => left.sequence - right.sequence,
  );
  // Recovery cutoffs read historical fallback events, so compute them first.
  const recoveredProviderFailures = recoveredProviderFailureCutoffs(sorted);
  const ordered = withoutRoutingEvents(sorted);
  const rows: ProjectedStreamRow[] = [];
  const toolRows = new Map<string, ProjectedStreamRow>();
  const aiRows = new Map<string, ProjectedStreamRow>();
  const aiStreamedText = new Map<string, string>();
  const runtimeRows = new Map<string, ProjectedStreamRow>();
  const lifecycleRows = new Map<string, ProjectedStreamRow>();
  const semanticToolIds = new Set<string>();
  const semanticModelOutputIds = new Set<string>();
  const semanticReasoningIds = new Set<string>();
  const modelTurnKeys = logicalModelTurnKeys(ordered);
  const logicalEvents = new Map<ProjectedStreamRow, AssessmentAgentStreamEvent[]>();
  const toolRowsByCall = new Map<string, ProjectedStreamRow>();
  const endedTurns = new Set<ProjectedStreamRow>();
  const pendingRuntimeByCall = new Map<string, AssessmentAgentStreamEvent[]>();
  const semanticCallKeys = new Set<string>();

  for (const event of ordered) {
    const semantic = semanticData(event.data);
    if (!semantic) continue;
    const toolIdentity = toolIdentityKey(event, semantic);
    if (
      toolIdentity &&
      (semantic.kind === ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.toolCall ||
        semantic.kind === ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.toolResult)
    ) {
      semanticToolIds.add(toolIdentity);
      if (event.toolCallId) semanticCallKeys.add(`${event.runId}:${event.toolCallId}`);
    }
    if (
      semantic.kind === ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.modelOutput &&
      event.messageId
    ) {
      semanticModelOutputIds.add(event.messageId);
    }
    if (
      semantic.kind ===
        ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.reasoningSummary &&
      event.messageId
    ) {
      semanticReasoningIds.add(event.messageId);
    }
  }

  let previousMergeKey: string | null = null;
  for (const event of ordered) {
    if (isAgentStreamRuleLifecycleEvent(event)) {
      // Rendered as the rule's own section header and result, not as a row.
      previousMergeKey = null;
      continue;
    }
    if (
      shouldSuppressEvent(
        event,
        semanticToolIds,
        semanticModelOutputIds,
        semanticReasoningIds,
        recoveredProviderFailures,
      )
    ) {
      continue;
    }

    const semantic = semanticData(event.data);
    const toolIdentity = semantic ? toolIdentityKey(event, semantic) : null;
    if (
      semantic &&
      toolIdentity &&
      (semantic.kind === ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.toolCall ||
        semantic.kind === ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.toolResult)
    ) {
      const existing = toolRows.get(toolIdentity);
      if (existing) {
        logicalEvents.get(existing)?.push(event);
        existing.sequence = event.sequence;
        existing.failed =
          existing.failed ||
          event.status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed;
        existing.status = existing.failed ? "failed" : "completed";
        existing.meta = semanticMeta(event, semantic);
        existing.technical = startAndLatestDetails(
          existing.technical,
          technicalEventDetails(event),
        );
        if (semantic.kind === ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.toolCall) {
          existing.input = cleanedStreamValue(semantic.parameters);
        } else {
          existing.output = cleanedStreamValue(semantic.resultSummary);
          existing.detail = null;
        }
        previousMergeKey = null;
        continue;
      }

      const activity = toolActivityKey(
        typeof semantic.toolName === "string"
          ? semantic.toolName
          : event.toolName,
        semantic.parameters ?? semantic.resultSummary ?? null,
      );
      const projected = toStreamRow(event);
      projected.kind = "tool";
      projected.activity = activity;
      projected.label = activityCopy(activity);
      projected.detail = null;
      projected.target = toolTarget(semantic.parameters);
      projected.input =
        semantic.kind === ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.toolCall
          ? cleanedStreamValue(semantic.parameters)
          : null;
      projected.output =
        semantic.kind === ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.toolResult
          ? cleanedStreamValue(semantic.resultSummary)
          : null;
      projected.status =
        semantic.kind === ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.toolResult
          ? projected.failed
            ? "failed"
            : "completed"
          : "running";
      rows.push(projected);
      toolRows.set(toolIdentity, projected);
      logicalEvents.set(projected, [event]);
      if (event.toolCallId) {
        const callKey = `${event.runId}:${event.toolCallId}`;
        toolRowsByCall.set(callKey, projected);
        for (const pending of pendingRuntimeByCall.get(callKey) ?? []) {
          foldRuntimeToolEvent(projected, pending, runtimeEventType(pending));
          logicalEvents.get(projected)?.push(pending);
        }
        pendingRuntimeByCall.delete(callKey);
      }
      previousMergeKey = null;
      continue;
    }

    const aiKey = aiActivityKey(event, semantic, modelTurnKeys.get(event.eventId));
    if (aiKey) {
      let aiRow = aiRows.get(aiKey);
      if (!aiRow) {
        aiRow = toStreamRow(event);
        aiRow.kind = "model";
        aiRow.detail = null;
        rows.push(aiRow);
        aiRows.set(aiKey, aiRow);
      } else if (event.agentName && aiRow.scope !== toStreamRow(event).scope) {
        // MODEL_CALL_* carry no agent; the turn adopts the agent of its request.
        aiRow.scope = toStreamRow(event).scope;
        aiRow.ruleId = aiRow.ruleId ?? event.engineeringRuleId;
      }
      logicalEvents.set(aiRow, [...(logicalEvents.get(aiRow) ?? []), event]);
      // Late stream chunks of a turn that already ended must not reopen it.
      const ended = endedTurns.has(aiRow);
      const endedState = { status: aiRow.status, failed: aiRow.failed };
      applyAiActivity(aiRow, event, semantic, aiStreamedText);
      if (ended) {
        if (
          event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallStarted
        ) {
          endedTurns.delete(aiRow);
        } else if (aiRow.status === "running") {
          Object.assign(aiRow, endedState);
        }
      }
      if (aiRow.status === "completed" || aiRow.status === "failed") {
        if (
          event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallCompleted ||
          event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallFailed ||
          event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallTimeout ||
          event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelResult
        ) {
          endedTurns.add(aiRow);
        }
      }
      previousMergeKey = null;
      continue;
    }

    // Runtime TOOL_* lifecycle of a call that already has its row is that row's
    // technical detail, not another activity.
    const runtimeToolType = runtimeEventType(event);
    const callKey =
      runtimeToolType?.startsWith("TOOL_") && event.toolCallId
        ? `${event.runId}:${event.toolCallId}`
        : null;
    if (callKey && semanticCallKeys.has(callKey)) {
      const callRow = toolRowsByCall.get(callKey);
      if (callRow) {
        foldRuntimeToolEvent(callRow, event, runtimeToolType);
        logicalEvents.get(callRow)?.push(event);
      } else {
        // The semantic call row is not open yet; attach when it opens.
        pendingRuntimeByCall.set(callKey, [
          ...(pendingRuntimeByCall.get(callKey) ?? []),
          event,
        ]);
      }
      previousMergeKey = null;
      continue;
    }

    const lifecycleProgressKey = lifecycleEventProgressKey(event);
    if (lifecycleProgressKey) {
      const existing = lifecycleRows.get(lifecycleProgressKey);
      if (existing) {
        const updated = toStreamRow(event);
        existing.sequence = event.sequence;
        existing.label = updated.label;
        existing.detail = updated.detail;
        existing.meta = updated.meta;
        existing.failed = updated.failed;
        existing.status = updated.status;
        existing.technical = startAndLatestDetails(
          existing.technical,
          updated.technical,
        );
        previousMergeKey = null;
        continue;
      }
      const projected = toStreamRow(event);
      rows.push(projected);
      lifecycleRows.set(lifecycleProgressKey, projected);
      previousMergeKey = null;
      continue;
    }

    const runtimeProgressKey = runtimeEventProgressKey(event);
    if (runtimeProgressKey) {
      const existing = runtimeRows.get(runtimeProgressKey);
      if (existing) {
        const updated = toStreamRow(event);
        existing.sequence = event.sequence;
        existing.label = updated.label;
        existing.detail = updated.detail;
        existing.meta = updated.meta;
        existing.failed = updated.failed;
        existing.status = updated.status;
        existing.technical = startAndLatestDetails(
          existing.technical,
          updated.technical,
        );
        previousMergeKey = null;
        continue;
      }
      const projected = toStreamRow(event);
      rows.push(projected);
      runtimeRows.set(runtimeProgressKey, projected);
      previousMergeKey = null;
      continue;
    }

    const mergeKey = deltaMergeKey(event);
    const previous = rows.at(-1);
    if (mergeKey && previous && previousMergeKey === mergeKey) {
      previous.detail = `${previous.detail ?? ""}${event.text ?? ""}`;
      previous.sequence = event.sequence;
      previous.technical = startAndLatestDetails(
        previous.technical,
        technicalEventDetails(event),
      );
      continue;
    }
    const projected = toStreamRow(event);
    rows.push(projected);
    previousMergeKey = mergeKey;
  }

  for (const [projected, rowEvents] of logicalEvents) {
    projected.usage =
      projected.kind === "model"
        ? modelTurnUsage(rowEvents)
        : projected.kind === "tool"
          ? toolCallMetrics(rowEvents)
          : undefined;
    projected.technical = withLogicalDetails(projected, rowEvents);
    projected.providerAttempts =
      projected.kind === "model"
        ? modelRoutingSummary(rowEvents).providerAttempts
        : undefined;
  }
  return finalizeProjectedRows(rows, ordered);
}

function foldRuntimeToolEvent(
  callRow: ProjectedStreamRow,
  event: AssessmentAgentStreamEvent,
  type: string | null,
): void {
  callRow.sequence = Math.max(callRow.sequence, event.sequence);
  callRow.failed = callRow.failed || type === "TOOL_FAILED";
  if (callRow.failed) callRow.status = "failed";
}

/** Scalar routing summary the runtime attaches to the turn's final model event. */
function modelRoutingSummary(events: AssessmentAgentStreamEvent[]): {
  providerAttempts?: number;
  credentialAttempts?: number;
  fallbackUsed?: boolean;
} {
  const final = events
    .filter(
      (event) =>
        event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallCompleted ||
        event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallFailed ||
        event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallTimeout,
    )
    .reduce<AssessmentAgentStreamEvent | undefined>(
      (a, b) => (!a || b.sequence >= a.sequence ? b : a),
      undefined,
    );
  const data = isSummaryRecord(final?.data) ? final.data : null;
  const count = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : undefined;
  return {
    providerAttempts: count(data?.provider_attempts),
    credentialAttempts: count(data?.credential_attempts),
    fallbackUsed:
      typeof data?.fallback_used === "boolean" ? data.fallback_used : undefined,
  };
}

function uniqueStrings(values: unknown[]): string[] {
  return [
    ...new Set(
      values.filter((v): v is string => typeof v === "string" && v !== ""),
    ),
  ];
}

/**
 * One logical activity's own audit block: the model turn or tool call it is,
 * with every provider attempt / lifecycle event folded in. Only identifiers and
 * counters are copied; prompts, credentials and raw source never are.
 */
function withLogicalDetails(
  projected: ProjectedStreamRow,
  events: AssessmentAgentStreamEvent[],
): AssessmentRuntimeSummaryValue | null {
  const first = events[0]!;
  const last = events.reduce((a, b) => (b.sequence >= a.sequence ? b : a));
  const datas = events.map((event) =>
    isSummaryRecord(event.data) ? event.data : null,
  );
  const elapsed = Date.parse(last.emittedAt) - Date.parse(first.emittedAt);
  const details: Record<string, AssessmentRuntimeSummaryValue> = {
    logicalActivity: projected.kind,
    eventCount: events.length,
    durationMs: Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null,
    status: projected.status,
  };
  if (projected.kind === "model") {
    const providers = uniqueStrings(datas.map((d) => d?.provider));
    const routing = modelRoutingSummary(events);
    if (routing.providerAttempts !== undefined)
      details.providerAttempts = routing.providerAttempts;
    if (routing.credentialAttempts !== undefined)
      details.credentialAttempts = routing.credentialAttempts;
    details.providers = providers;
    details.models = uniqueStrings(datas.map((d) => d?.model));
    details.fallbackUsed = routing.fallbackUsed ?? providers.length > 1;
    details.requestIds = uniqueStrings([
      ...events.map((event) => event.messageId),
      ...datas.map((d) => d?.requestId),
    ]);
    details.modelStepId = uniqueStrings(datas.map((d) => d?.model_step_id))[0] ?? null;
    details.errors = uniqueStrings(
      datas.flatMap((d) => [d?.error_type, d?.error_code, d?.reason]),
    );
    details.failedAttempts = events.filter(
      (event) =>
        event.status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed ||
        event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallFailed,
    ).length;
  } else {
    details.tool = uniqueStrings(events.map((event) => event.toolName))[0] ?? null;
    details.callId = uniqueStrings(events.map((event) => event.toolCallId))[0] ?? null;
    details.runtimeEventTypes = uniqueStrings(
      datas.map((d) => d?.runtimeEventType),
    );
    details.retryCount = Math.max(
      0,
      events.filter(
        (event) =>
          semanticData(event.data)?.kind ===
          ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.toolCall,
      ).length - 1,
    );
  }
  if (projected.usage) details.usage = projected.usage;
  const cleaned = Object.fromEntries(
    Object.entries(details).filter(([, v]) => v !== null),
  );
  const existing = projected.technical;
  return existing === null
    ? cleaned
    : [...(Array.isArray(existing) ? existing : [existing]), cleaned];
}

export function finalizeProjectedRows(
  rows: ProjectedStreamRow[],
  events: AssessmentAgentStreamEvent[],
): ProjectedStreamRow[] {
  const outcomes = terminalOutcomesByRun(events);
  return rows.map((row) => {
    if (row.status !== "running") return row;
    const outcome = outcomes.get(row.dispatchKey);
    if (!outcome) return row;
    return {
      ...row,
      status: outcome === "paused" ? "neutral" : outcome,
      failed: outcome === "failed",
      label:
        outcome === "failed" && row.kind === "model"
          ? activityCopy("aiAnalysisFailed")
          : row.label,
    };
  });
}

/**
 * Collapses a scope's rows into one live row per activity kind (file reads,
 * searches, AI steps, context trims, ...) instead of one row per event, even
 * when kinds interleave. The row keeps its first position; its label, target
 * and status follow the latest occurrence, and every occurrence stays
 * inspectable under `completedTurns`. Failures group apart so they stay visible.
 */
export function groupRepeatedActivities(
  rows: ProjectedStreamRow[],
): ProjectedStreamRow[] {
  const grouped: ProjectedStreamRow[] = [];
  const positions = new Map<string, number>();
  for (const current of rows) {
    const key = JSON.stringify([
      current.scope,
      current.kind,
      current.activity ?? (current.kind === "model" ? null : current.label),
      current.failed,
    ]);
    const position = positions.get(key);
    if (position === undefined) {
      positions.set(key, grouped.length);
      grouped.push(current);
      continue;
    }
    const previous = grouped[position]!;
    const turns = [...(previous.completedTurns ?? [previous]), current];
    const latest = turns.reduce((left, right) =>
      right.sequence >= left.sequence ? right : left,
    );
    grouped[position] = {
      ...latest,
      id: previous.id,
      firstSequence: previous.firstSequence,
      status: turns.some((turn) => turn.status === STREAM_ROW_STATUSES.running)
        ? STREAM_ROW_STATUSES.running
        : latest.status,
      completedTurns: turns,
    };
  }
  return grouped;
}

export function finalizeRuleHeaders(
  headers: Map<string, AgentStreamRuleHeader>,
  events: AssessmentAgentStreamEvent[],
  outcomeOverride?: AgentStreamRunOutcome,
): Map<string, AgentStreamRuleHeader> {
  const outcomes = terminalOutcomesByRun(events);
  const owners = new Map<string, string>();
  for (const event of [...events].sort(
    (left, right) => left.sequence - right.sequence,
  )) {
    if (!isAgentStreamRuleLifecycleEvent(event)) continue;
    const semanticRuleId = semanticData(event.data)?.engineeringRuleId;
    const ruleId =
      event.engineeringRuleId ??
      (typeof semanticRuleId === "string" ? semanticRuleId : null);
    if (ruleId !== null) owners.set(ruleId, dispatchKey(event));
  }
  // Only the dispatch that last owned this rule may close its open activity.
  return new Map(
    [...headers].map(([ruleId, header]) => {
      const owner = owners.get(ruleId);
      const outcome =
        (owner ? outcomes.get(owner) : undefined) ??
        (outcomeOverride === AGENT_STREAM_RUN_OUTCOMES.running
          ? undefined
          : outcomeOverride);
      return [
        ruleId,
        outcome && header.status === ASSESSMENT_RUNTIME_RUN_STATUSES.running
          ? {
              ...header,
              status:
                outcome === "paused"
                  ? ASSESSMENT_RUNTIME_RUN_STATUSES.waiting
                  : outcome === "failed"
                    ? ASSESSMENT_RUNTIME_RUN_STATUSES.failed
                    : ASSESSMENT_RUNTIME_RUN_STATUSES.completed,
            }
          : header,
      ];
    }),
  );
}

export const TERMINAL_OUTCOMES = {
  completed: "completed",
  failed: "failed",
  paused: "paused",
} as const;

export type TerminalOutcome =
  (typeof TERMINAL_OUTCOMES)[keyof typeof TERMINAL_OUTCOMES];

export function dispatchKey(event: AssessmentAgentStreamEvent): string {
  return agentStreamTurnKey(event);
}

export function terminalOutcomesByRun(
  events: AssessmentAgentStreamEvent[],
): Map<string, TerminalOutcome> {
  const outcomes = new Map<string, TerminalOutcome>();
  const stopped = new Set<string>();
  const activeBoundaryStages = new Map<
    string,
    AssessmentAgentStreamEvent["stage"]
  >();
  for (const event of [...events].sort(
    (left, right) => left.sequence - right.sequence,
  )) {
    const key = dispatchKey(event);
    const runtimeType = runtimeEventType(event);
    if (
      event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.runtimeStopped
    ) {
      stopped.add(key);
      outcomes.set(key, TERMINAL_OUTCOMES.paused);
      continue;
    }
    // Late worker bookkeeping cannot reopen an acknowledged native stop.
    if (stopped.has(key)) continue;
    if (
      event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryStarted
    ) {
      activeBoundaryStages.set(key, event.stage);
      outcomes.delete(key);
      continue;
    }
    if (
      (event.eventType ===
        ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryCompleted ||
        event.eventType ===
          ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryFailed ||
        event.eventType ===
          ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryPaused) &&
      activeBoundaryStages.has(key) &&
      event.stage !== null &&
      activeBoundaryStages.get(key) !== event.stage
    ) {
      continue;
    }
    if (runtimeType === "RUN_STARTED") {
      outcomes.delete(key);
      continue;
    }
    if (
      event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.agentFailed ||
      event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryFailed ||
      runtimeType === "RUN_FAILED"
    ) {
      outcomes.set(key, TERMINAL_OUTCOMES.failed);
      continue;
    }
    if (
      event.eventType ===
        ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryCompleted ||
      event.eventType ===
        ASSESSMENT_AGENT_STREAM_EVENT_TYPES.runtimeCompleted ||
      runtimeType === "RUN_COMPLETED"
    ) {
      // Dispatch completion means processing ended, not rule-analysis success.
      if (outcomes.get(key) !== TERMINAL_OUTCOMES.failed)
        outcomes.set(key, TERMINAL_OUTCOMES.completed);
    }
    if (
      event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryPaused
    ) {
      if (outcomes.get(key) !== TERMINAL_OUTCOMES.failed)
        outcomes.set(key, TERMINAL_OUTCOMES.paused);
    }
  }
  return outcomes;
}

export function hasOpenBoundary(events: AssessmentAgentStreamEvent[]): boolean {
  const open = new Map<string, AssessmentAgentStreamEvent["stage"]>();
  const settledNativeRuns = new Set<string>();
  for (const event of [...events].sort(
    (left, right) => left.sequence - right.sequence,
  )) {
    const key = dispatchKey(event);
    if (settledNativeRuns.has(key)) continue;
    if (
      event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.runtimeStopped ||
      event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.runtimeCompleted
    ) {
      settledNativeRuns.add(key);
      open.delete(key);
      continue;
    }
    if (
      event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryStarted
    ) {
      open.set(dispatchKey(event), event.stage);
    } else if (
      (event.eventType ===
        ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryCompleted ||
        event.eventType ===
          ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryFailed ||
        event.eventType ===
          ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryPaused) &&
      (event.stage === null || event.stage === open.get(dispatchKey(event)))
    ) {
      open.delete(dispatchKey(event));
    }
  }
  return open.size > 0;
}

export function deltaMergeKey(
  event: AssessmentAgentStreamEvent,
): string | null {
  if (
    event.eventType !== ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelContentDelta &&
    event.eventType !==
      ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelReasoningDelta &&
    event.eventType !== ASSESSMENT_AGENT_STREAM_EVENT_TYPES.toolCallDelta
  ) {
    return null;
  }
  return [
    event.runId,
    event.eventType,
    event.agentName ?? "",
    event.messageId ?? "",
    event.toolCallId ?? "",
    event.namespace.join("/"),
  ].join(":");
}

export function toStreamRow(
  event: AssessmentAgentStreamEvent,
): ProjectedStreamRow {
  const semantic = semanticData(event.data);
  if (semantic) {
    const failed =
      event.status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed ||
      semantic.status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed;
    const outputText =
      semantic.kind === ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.modelOutput
        ? modelOutputText(semantic)
        : null;
    return row(
      event,
      outputText
        ? activityCopy("agentStepOutput")
        : meaningfulSemanticActivity(event, semantic),
      semantic.kind === ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.reasoningSummary
        ? (reasoningSummaryText(semantic) ?? event.text)
        : outputText,
      semanticMeta(event, semantic),
      failed,
    );
  }

  switch (event.eventType) {
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.subagentSelected:
      return row(
        event,
        activityCopy("subagentSelected"),
        null,
        eventMeta(event),
      );
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.agentStarted:
      return row(
        event,
        activityCopy("repositoryAnalysisStarted"),
        null,
        eventMeta(event),
      );
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.agentCompleted:
      return row(
        event,
        activityCopy("repositoryAnalysisCompleted"),
        null,
        eventMeta(event),
      );
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.agentFailed:
      return row(
        event,
        activityCopy("repositoryAnalysisFailed"),
        null,
        eventMeta(event),
        true,
      );
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryStarted:
      return row(
        event,
        activityCopy("scanWorkflowStarted"),
        null,
        eventMeta(event),
      );
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryCompleted:
      return row(
        event,
        activityCopy("scanWorkflowCompleted"),
        null,
        eventMeta(event),
      );
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryFailed:
      return row(
        event,
        activityCopy("scanWorkflowFailed"),
        null,
        eventMeta(event),
        true,
      );
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryPaused:
      return row(event, activityCopy("boundaryPaused"), null, eventMeta(event));
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelReasoningDelta:
      return row(
        event,
        activityCopy("reasoningReviewed"),
        event.text,
        eventMeta(event),
      );
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelContentDelta:
      return row(
        event,
        activityCopy("modelOutputReviewed"),
        event.text,
        eventMeta(event),
      );
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.toolCallDelta:
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.toolResult:
      return row(
        event,
        meaningfulToolActivity(event.toolName, event.data),
        null,
        eventMeta(event),
      );
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.log:
      return row(
        event,
        activityCopy("runtimeProgress"),
        null,
        eventMeta(event),
      );
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.runtimeEvent: {
      const projected = row(
        event,
        meaningfulRuntimeActivity(event),
        null,
        eventMeta(event),
        event.status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed,
      );
      projected.status = runtimeEventStatus(event);
      projected.failed = projected.status === "failed";
      return projected;
    }
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.customProgress:
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.graphUpdate:
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.graphState:
      return row(
        event,
        activityCopy("analysisProgressUpdated"),
        null,
        eventMeta(event),
      );
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.agentBudgetReached: {
      const exhausted = event.status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed;
      const projected = row(
        event,
        activityCopy(exhausted ? "agentBudgetExhausted" : "agentBudgetReached"),
        null,
        eventMeta(event),
        exhausted,
      );
      projected.status = exhausted ? "failed" : "completed";
      return projected;
    }
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.agentContextTrimmed: {
      const projected = row(
        event,
        activityCopy("agentContextTrimmed"),
        null,
        eventMeta(event),
      );
      projected.status = "completed";
      return projected;
    }
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.providerFallback: {
      const projected = row(
        event,
        activityCopy("providerFallback"),
        null,
        eventMeta(event),
      );
      projected.status = "completed";
      return projected;
    }
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.credentialRotation: {
      const projected = row(
        event,
        activityCopy("credentialRotation"),
        null,
        eventMeta(event),
      );
      projected.status = "completed";
      return projected;
    }
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.scannerActivity:
      return row(
        event,
        activityCopy("repositoryEvidenceInspected"),
        null,
        eventMeta(event),
      );
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.engineeringRule:
      return row(
        event,
        activityCopy("engineeringRuleEvaluated"),
        null,
        eventMeta(event),
      );
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.skillUsage:
      return row(
        event,
        activityCopy("analysisSkillApplied"),
        null,
        eventMeta(event),
      );
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.ruleProvenance:
      return row(
        event,
        activityCopy("evidenceProvenanceLinked"),
        null,
        eventMeta(event),
      );
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelRequest:
      return row(
        event,
        activityCopy("aiAnalysisRunning"),
        null,
        eventMeta(event),
      );
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelResult:
      return row(
        event,
        activityCopy("aiAnalysisCompleted"),
        null,
        eventMeta(event),
      );
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallStarted:
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallHeartbeat:
      return row(
        event,
        activityCopy("aiAnalysisRunning"),
        null,
        modelCallMeta(event),
      );
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallCompleted:
      return row(
        event,
        activityCopy("aiAnalysisCompleted"),
        null,
        modelCallMeta(event),
      );
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallFailed:
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallTimeout:
      return row(
        event,
        activityCopy("aiAnalysisFailed"),
        null,
        modelCallMeta(event),
        true,
      );
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.semanticToolCall:
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.semanticToolResult:
      return row(
        event,
        meaningfulToolActivity(event.toolName, event.data),
        null,
        eventMeta(event),
      );
    default:
      return row(
        event,
        activityCopy("analysisProgressUpdated"),
        null,
        eventMeta(event),
      );
  }
}

export function meaningfulSemanticActivity(
  event: AssessmentAgentStreamEvent,
  semantic: SemanticRecord,
): string {
  switch (semantic.kind) {
    case ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.toolCall:
    case ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.toolResult:
      return meaningfulToolActivity(
        firstString(semantic.toolName, event.toolName),
        semantic.parameters ?? semantic.resultSummary ?? null,
      );
    case ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.reasoningSummary:
      return activityCopy("agentReasoning");
    case ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.modelRequest:
    case ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.decisionModel:
      return activityCopy("aiAnalysisRunning");
    case ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.modelOutput:
      return activityCopy("aiAnalysisCompleted");
    case ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.scannerFile:
    case ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.scannerSymbol:
    case ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.scannerDependency:
    case ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.scannerTraceStep:
      return activityCopy("repositoryEvidenceInspected");
    case ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.engineeringRule:
      return activityCopy("engineeringRuleEvaluated");
    case ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.skillUsage:
      return activityCopy("analysisSkillApplied");
    case ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.ruleProvenance:
      return activityCopy("evidenceProvenanceLinked");
    default:
      return activityCopy("analysisProgressUpdated");
  }
}

export function meaningfulRuntimeActivity(
  event: AssessmentAgentStreamEvent,
): string {
  const data = isSummaryRecord(event.data) ? event.data : null;
  const identity = (
    event.toolName ??
    event.nodeName ??
    event.source ??
    ""
  ).toLowerCase();
  const runtimeEventType =
    summaryString(data?.runtimeEventType)?.toUpperCase() ?? "";
  const outputSummary = data?.outputSummary;
  const outputText =
    typeof outputSummary === "string"
      ? outputSummary.toLowerCase()
      : outputSummary === undefined || outputSummary === null
        ? ""
        : formatSemanticValue(outputSummary).toLowerCase();
  const text = (event.text ?? "").toLowerCase();

  if (identity.includes("repository_archive_download")) {
    return text.includes("downloaded") || runtimeEventType === "TOOL_COMPLETED"
      ? activityCopy("repositorySourceDownloaded")
      : activityCopy("repositorySourceDownloading");
  }
  if (identity.includes("repository_sandbox_hydration")) {
    return text.includes("hydrated") || runtimeEventType === "TOOL_COMPLETED"
      ? activityCopy("repositoryWorkspaceReady")
      : activityCopy("repositoryWorkspacePreparing");
  }
  if (identity.includes("repository_deep_analysis")) {
    return event.status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed
      ? activityCopy("repositoryAnalysisFailed")
      : activityCopy("repositoryDeepAnalysis");
  }
  if (identity.includes("langgraph_run")) {
    if (
      event.status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed ||
      outputText.includes("error")
    ) {
      return activityCopy("repositoryAnalysisFailed");
    }
    if (
      runtimeEventType === "TOOL_COMPLETED" ||
      text.includes("state: running") ||
      outputText.includes("running")
    ) {
      return activityCopy("repositoryAnalysisRunning");
    }
    return activityCopy("repositoryAnalysisQueued");
  }
  if (identity.includes("agent_runtime")) {
    return event.status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed
      ? activityCopy("scanWorkflowFailed")
      : activityCopy("repositoryScanStarted");
  }
  if (identity.includes("runtime-event")) {
    return activityCopy("runtimeProgressConnected");
  }
  return activityCopy("runtimeProgress");
}

export function meaningfulToolActivity(
  toolName: string | null | undefined,
  payload: AssessmentRuntimeSummaryValue | null | undefined,
): string {
  return activityCopy(toolActivityKey(toolName, payload));
}

export function toolActivityKey(
  toolName: string | null | undefined,
  payload: AssessmentRuntimeSummaryValue | null | undefined,
): StreamActivityKey {
  const name = (toolName ?? "").toLowerCase();
  const searchable =
    `${name} ${formatSemanticValue(payload ?? "")}`.toLowerCase();

  if (/\b(git\s+push|git_push)\b/.test(searchable)) return "changesPushed";
  if (/\b(git\s+commit|git_commit)\b/.test(searchable))
    return "changesCommitted";
  if (
    /\b(pytest|vitest|jest|test:web|test:e2e|pnpm test|npm test)\b/.test(
      searchable,
    )
  ) {
    return "targetedTestsRan";
  }
  if (/\b(eslint|ruff|lint)\b/.test(searchable)) return "codeQualityValidated";
  if (/\b(tsc|typecheck|py_compile|mypy)\b/.test(searchable)) {
    return "typeSafetyValidated";
  }
  if (
    /\b(apply_patch|write_file|edit_file|patch_apply|workspace_file_write)\b/.test(
      searchable,
    )
  ) {
    return "implementationUpdated";
  }
  if (/\b(git\s+diff|git\s+status|git\s+log|git_review)\b/.test(searchable)) {
    return "repositoryChangesReviewed";
  }
  // Typed queries over the pre-indexed Codebase Memory graph (checked before
  // the generic search match so graph use stays visible as its own activity).
  if (
    /\b(search_code_graph|trace_call_path|get_code_snippet|search_code_text|get_repository_architecture|codebase-memory-graph)\b/.test(
      searchable,
    )
  ) {
    return "codebaseGraphQueried";
  }
  if (/\b(grep|rg|search|search_nodes)\b/.test(searchable)) {
    return "repositorySourceSearched";
  }
  if (/\b(find|glob|locate)\b/.test(searchable)) return "relevantFilesLocated";
  if (/\b(read_file|cat|sed|open_file)\b/.test(searchable)) {
    return "sourceFilesReviewed";
  }
  if (name === "ls" || /\b(list_files|list_directory)\b/.test(searchable)) {
    return "repositoryFilesInspected";
  }
  return "repositoryToolRan";
}

export function activityCopy(key: StreamActivityKey): string {
  return streamActivityLabels()[key];
}

export function streamActivityLabels() {
  return {
    boundaryPaused: t("pages.appShell.agentStreamActivities.boundaryPaused"),
    repositoryScanStarted: t(
      "pages.appShell.agentStreamActivities.repositoryScanStarted",
    ),
    repositoryAnalysisStarted: t(
      "pages.appShell.agentStreamActivities.repositoryAnalysisStarted",
    ),
    repositoryAnalysisCompleted: t(
      "pages.appShell.agentStreamActivities.repositoryAnalysisCompleted",
    ),
    repositoryAnalysisFailed: t(
      "pages.appShell.agentStreamActivities.repositoryAnalysisFailed",
    ),
    scanWorkflowStarted: t(
      "pages.appShell.agentStreamActivities.scanWorkflowStarted",
    ),
    scanWorkflowCompleted: t(
      "pages.appShell.agentStreamActivities.scanWorkflowCompleted",
    ),
    scanWorkflowFailed: t(
      "pages.appShell.agentStreamActivities.scanWorkflowFailed",
    ),
    repositoryAnalysisQueued: t(
      "pages.appShell.agentStreamActivities.repositoryAnalysisQueued",
    ),
    repositoryAnalysisRunning: t(
      "pages.appShell.agentStreamActivities.repositoryAnalysisRunning",
    ),
    repositorySourceDownloading: t(
      "pages.appShell.agentStreamActivities.repositorySourceDownloading",
    ),
    repositorySourceDownloaded: t(
      "pages.appShell.agentStreamActivities.repositorySourceDownloaded",
    ),
    repositoryWorkspacePreparing: t(
      "pages.appShell.agentStreamActivities.repositoryWorkspacePreparing",
    ),
    repositoryWorkspaceReady: t(
      "pages.appShell.agentStreamActivities.repositoryWorkspaceReady",
    ),
    repositoryDeepAnalysis: t(
      "pages.appShell.agentStreamActivities.repositoryDeepAnalysis",
    ),
    runtimeProgressConnected: t(
      "pages.appShell.agentStreamActivities.runtimeProgressConnected",
    ),
    runtimeProgress: t("pages.appShell.agentStreamActivities.runtimeProgress"),
    analysisProgressUpdated: t(
      "pages.appShell.agentStreamActivities.analysisProgressUpdated",
    ),
    reasoningReviewed: t(
      "pages.appShell.agentStreamActivities.reasoningReviewed",
    ),
    modelOutputReviewed: t(
      "pages.appShell.agentStreamActivities.modelOutputReviewed",
    ),
    aiAnalysisRunning: t(
      "pages.appShell.agentStreamActivities.aiAnalysisRunning",
    ),
    aiAnalysisCompleted: t(
      "pages.appShell.agentStreamActivities.aiAnalysisCompleted",
    ),
    aiAnalysisFailed: t(
      "pages.appShell.agentStreamActivities.aiAnalysisFailed",
    ),
    providerFallback: t(
      "pages.appShell.agentStreamActivities.providerFallback",
    ),
    credentialRotation: t(
      "pages.appShell.agentStreamActivities.credentialRotation",
    ),
    repositoryEvidenceInspected: t(
      "pages.appShell.agentStreamActivities.repositoryEvidenceInspected",
    ),
    engineeringRuleEvaluated: t(
      "pages.appShell.agentStreamActivities.engineeringRuleEvaluated",
    ),
    analysisSkillApplied: t(
      "pages.appShell.agentStreamActivities.analysisSkillApplied",
    ),
    evidenceProvenanceLinked: t(
      "pages.appShell.agentStreamActivities.evidenceProvenanceLinked",
    ),
    repositoryFilesInspected: t(
      "pages.appShell.agentStreamActivities.repositoryFilesInspected",
    ),
    repositorySourceSearched: t(
      "pages.appShell.agentStreamActivities.repositorySourceSearched",
    ),
    codebaseGraphQueried: t(
      "pages.appShell.agentStreamActivities.codebaseGraphQueried",
    ),
    sourceFilesReviewed: t(
      "pages.appShell.agentStreamActivities.sourceFilesReviewed",
    ),
    relevantFilesLocated: t(
      "pages.appShell.agentStreamActivities.relevantFilesLocated",
    ),
    repositoryChangesReviewed: t(
      "pages.appShell.agentStreamActivities.repositoryChangesReviewed",
    ),
    implementationUpdated: t(
      "pages.appShell.agentStreamActivities.implementationUpdated",
    ),
    targetedTestsRan: t(
      "pages.appShell.agentStreamActivities.targetedTestsRan",
    ),
    codeQualityValidated: t(
      "pages.appShell.agentStreamActivities.codeQualityValidated",
    ),
    typeSafetyValidated: t(
      "pages.appShell.agentStreamActivities.typeSafetyValidated",
    ),
    changesCommitted: t(
      "pages.appShell.agentStreamActivities.changesCommitted",
    ),
    changesPushed: t("pages.appShell.agentStreamActivities.changesPushed"),
    repositoryToolRan: t(
      "pages.appShell.agentStreamActivities.repositoryToolRan",
    ),
    subagentSelected: t(
      "pages.appShell.agentStreamActivities.subagentSelected",
    ),
    agentReasoning: t("pages.appShell.agentStreamActivities.agentReasoning"),
    agentStepOutput: t("pages.appShell.agentStreamActivities.agentStepOutput"),
    agentBudgetReached: t(
      "pages.appShell.agentStreamActivities.agentBudgetReached",
    ),
    agentBudgetExhausted: t(
      "pages.appShell.agentStreamActivities.agentBudgetExhausted",
    ),
    agentContextTrimmed: t(
      "pages.appShell.agentStreamActivities.agentContextTrimmed",
    ),
  };
}

export function summaryString(
  value: AssessmentRuntimeSummaryValue | undefined,
): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function row(
  event: AssessmentAgentStreamEvent,
  label: string,
  detail: string | null,
  meta: string | null,
  failed = false,
): ProjectedStreamRow {
  return {
    dispatchKey: dispatchKey(event),
    id: event.eventId,
    runId: event.runId,
    ruleId: event.engineeringRuleId,
    firstSequence: event.sequence,
    sequence: event.sequence,
    label,
    detail,
    meta,
    failed,
    kind: streamRowKind(event),
    status: streamRowStatus(event, failed),
    input: null,
    output: null,
    technical: technicalEventDetails(event),
    target: null,
    activity: null,
    scope: [
      event.runId,
      event.correlationId,
      event.stage ?? "",
      event.engineeringRuleId ?? "",
      event.agentName ?? "",
      event.subagentName ?? "",
      event.namespace.join("/"),
    ].join(":"),
  };
}

export function streamRowKind(
  event: AssessmentAgentStreamEvent,
): StreamRowKind {
  switch (event.eventType) {
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelReasoningDelta:
      return "reasoning";
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelRequest:
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelResult:
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallStarted:
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallHeartbeat:
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallCompleted:
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallFailed:
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallTimeout:
      return "model";
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.toolCallDelta:
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.toolResult:
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.semanticToolCall:
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.semanticToolResult:
      return "tool";
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.log:
      return "log";
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.customProgress:
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.scannerActivity:
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.agentBudgetReached:
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.agentContextTrimmed:
      return "progress";
    default:
      return "activity";
  }
}

export function streamRowStatus(
  event: AssessmentAgentStreamEvent,
  failed: boolean,
): StreamRowStatus {
  if (
    failed ||
    event.status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed ||
    event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallFailed ||
    event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallTimeout ||
    event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.agentFailed ||
    event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryFailed
  ) {
    return "failed";
  }
  if (
    event.status === ASSESSMENT_RUNTIME_RUN_STATUSES.completed ||
    event.eventType ===
      ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallCompleted ||
    event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.agentCompleted ||
    event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryCompleted
  ) {
    return "completed";
  }
  if (
    event.status === ASSESSMENT_RUNTIME_RUN_STATUSES.running ||
    event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallStarted ||
    event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallHeartbeat
  ) {
    return "running";
  }
  return "neutral";
}

export function eventMeta(event: AssessmentAgentStreamEvent): string | null {
  const parts = [
    event.namespace.length > 0 ? event.namespace.join(" › ") : null,
    event.nodeName,
    event.status,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function modelCallMeta(
  event: AssessmentAgentStreamEvent,
): string | null {
  const data = isSummaryRecord(event.data) ? event.data : null;
  const fields =
    data === null
      ? []
      : semanticDisplayFields(data, [
          "provider",
          "model",
          "elapsed_seconds",
          "timeout_seconds",
          "attempt",
          "error_type",
          "error_code",
        ]);
  const meta = eventMeta(event);
  return [meta, ...fields].filter(Boolean).join("\n") || null;
}

export type SemanticRecord = Record<string, AssessmentRuntimeSummaryValue>;

export function semanticData(
  value: AssessmentRuntimeSummaryValue | null,
): SemanticRecord | null {
  if (!isSummaryRecord(value)) return null;
  if (
    value.schemaVersion !==
      ASSESSMENT_AGENT_STREAM_SCHEMA_VERSIONS.semanticV1 ||
    typeof value.kind !== "string"
  ) {
    return null;
  }
  return value;
}

export function semanticMeta(
  event: AssessmentAgentStreamEvent,
  semantic: SemanticRecord,
): string | null {
  const correlation = [
    event.namespace.length > 0 ? event.namespace.join(" › ") : null,
    event.nodeName,
    event.messageId,
    event.toolCallId,
    semantic.durability,
  ].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  return correlation.length > 0 ? correlation.join(" · ") : eventMeta(event);
}

export function isSummaryRecord(
  value: AssessmentRuntimeSummaryValue | null | undefined,
): value is SemanticRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function firstString(
  ...values: Array<AssessmentRuntimeSummaryValue | string | null | undefined>
): string {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "runtime";
}

export function semanticDisplayFields(
  semantic: SemanticRecord,
  keys: string[],
): string[] {
  return keys.flatMap((key) => {
    const value = semantic[key];
    if (value === undefined || value === null || value === "") return [];
    if (Array.isArray(value) && value.length === 0) return [];
    return [`${humanizeSemanticKey(key)}: ${formatSemanticValue(value)}`];
  });
}

export function formatSemanticValue(
  value: AssessmentRuntimeSummaryValue,
): string {
  if (Array.isArray(value)) {
    return value.map((item) => formatSemanticValue(item)).join(", ");
  }
  if (value !== null && typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

export function humanizeSemanticKey(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .trim();
}

export function technicalEventDetails(
  event: AssessmentAgentStreamEvent,
): AssessmentRuntimeSummaryValue | null {
  const data = isSummaryRecord(event.data) ? event.data : null;
  const details: Record<string, AssessmentRuntimeSummaryValue> = {
    eventType: event.eventType,
    runtimeEventType:
      typeof data?.runtimeEventType === "string"
        ? data.runtimeEventType
        : event.eventType,
    status: event.status,
    source: event.source,
    agentName: event.agentName,
    subagentName: event.subagentName,
    nodeName: event.nodeName,
    toolName: event.toolName,
    provider: typeof data?.provider === "string" ? data.provider : null,
    model: typeof data?.model === "string" ? data.model : null,
    runId: event.runId,
    correlationId: event.correlationId,
    messageId: event.messageId,
    callId: event.toolCallId,
    namespace: event.namespace.length > 0 ? event.namespace : null,
    emittedAt: event.emittedAt,
    text: event.text,
    payload: cleanedStreamValue(event.data),
  };
  const cleaned = Object.fromEntries(
    Object.entries(details).filter(
      ([, value]) => value !== null && value !== "",
    ),
  );
  return Object.keys(cleaned).length > 0 ? cleaned : null;
}

export /**
 * A row keeps the event that opened it and the latest one only. Heartbeats,
 * retries and repeated calls replace the latest state instead of growing the
 * row into one ever-longer log.
 */
function startAndLatestDetails(
  current: AssessmentRuntimeSummaryValue | null,
  latest: AssessmentRuntimeSummaryValue | null,
): AssessmentRuntimeSummaryValue | null {
  if (latest === null) return current;
  if (current === null) return latest;
  const start = Array.isArray(current) ? (current[0] ?? null) : current;
  return start === null ? latest : [start, latest];
}

export function formatStreamValue(
  value: AssessmentRuntimeSummaryValue,
): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

export function cleanedStreamValue(
  value: AssessmentRuntimeSummaryValue | undefined | null,
): AssessmentRuntimeSummaryValue | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    return value === "[HIDDEN_PRIVATE_RUNTIME_STATE]" ? null : value;
  }
  if (Array.isArray(value)) {
    const cleaned = value
      .map((item) => cleanedStreamValue(item))
      .filter((item): item is AssessmentRuntimeSummaryValue => item !== null);
    return cleaned.length > 0 ? cleaned : null;
  }
  if (typeof value === "object") {
    if (
      value.hidden === "private_runtime_state" ||
      value.hidden === "[HIDDEN_PRIVATE_RUNTIME_STATE]"
    ) {
      return null;
    }
    const entries = Object.entries(value).flatMap(([key, nested]) => {
      const cleaned = cleanedStreamValue(nested);
      return cleaned === null ? [] : ([[key, cleaned]] as const);
    });
    return entries.length > 0 ? Object.fromEntries(entries) : null;
  }
  return value;
}

export function shouldSuppressEvent(
  event: AssessmentAgentStreamEvent,
  semanticToolIds: Set<string>,
  semanticModelOutputIds: Set<string>,
  semanticReasoningIds: Set<string>,
  recoveredProviderFailures: Map<string, number>,
): boolean {
  const identity = [event.nodeName, event.toolName, event.source, event.text]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  if (identity.includes("piimiddleware[")) return true;
  if (
    event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.graphUpdate ||
    event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.graphState
  ) {
    return true;
  }
  const recoveredProviderKey = modelCallProgressKey(event);
  if (
    recoveredProviderKey &&
    event.sequence < (recoveredProviderFailures.get(recoveredProviderKey) ?? -1)
  ) {
    return true;
  }
  if (event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.toolCallDelta) {
    return true;
  }
  if (
    event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.toolResult &&
    semanticToolIds.has(toolIdentityKey(event, null) ?? "")
  ) {
    return true;
  }
  if (
    event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelContentDelta &&
    event.messageId !== null &&
    semanticModelOutputIds.has(event.messageId)
  ) {
    return true;
  }
  if (
    event.eventType ===
      ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelReasoningDelta &&
    event.messageId !== null &&
    semanticReasoningIds.has(event.messageId)
  ) {
    return true;
  }
  if (cleanedStreamValue(event.data) !== null || event.text) {
    return false;
  }
  return !(
    event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.agentStarted ||
    event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.agentCompleted ||
    event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.agentFailed ||
    event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryStarted ||
    event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryCompleted ||
    event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryFailed
  );
}

export function recoveredProviderFailureCutoffs(
  events: AssessmentAgentStreamEvent[],
): Map<string, number> {
  const cutoffs = new Map<string, number>();
  const failedModelCalls = events.filter(
    (event) =>
      event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallFailed ||
      event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallTimeout,
  );
  for (const fallback of events) {
    if (
      fallback.eventType !==
      ASSESSMENT_AGENT_STREAM_EVENT_TYPES.providerFallback
    ) {
      continue;
    }
    const data = isSummaryRecord(fallback.data) ? fallback.data : null;
    const provider =
      typeof data?.current_provider === "string"
        ? data.current_provider.trim().toLowerCase()
        : "";
    if (!provider) continue;
    for (const failed of failedModelCalls) {
      if (
        failed.runId !== fallback.runId ||
        failed.sequence >= fallback.sequence
      ) {
        continue;
      }
      const failedData = isSummaryRecord(failed.data) ? failed.data : null;
      if (
        typeof failedData?.provider !== "string" ||
        failedData.provider.trim().toLowerCase() !== provider
      ) {
        continue;
      }
      const key = modelCallProgressKey(failed);
      if (!key) continue;
      const existing = cutoffs.get(key);
      if (existing === undefined || fallback.sequence < existing) {
        cutoffs.set(key, fallback.sequence);
      }
    }
  }
  return cutoffs;
}

export function toolIdentityKey(
  event: AssessmentAgentStreamEvent,
  semantic: SemanticRecord | null,
): string | null {
  const toolCallId =
    (typeof semantic?.toolCallId === "string" ? semantic.toolCallId : null) ??
    event.toolCallId;
  const scope = [
    event.runId,
    event.stage ?? "",
    event.agentName ?? "",
    event.namespace.join("/"),
  ].join(":");
  if (toolCallId) return `${scope}:${toolCallId}`;
  if (event.messageId && (event.toolName || semantic?.toolName)) {
    return `${scope}:${event.messageId}:${String(
      semantic?.toolName ?? event.toolName,
    )}`;
  }
  return null;
}

export // Arguments that name what a tool acts on, in display priority order.
const TOOL_TARGET_PARAMETER_KEYS = [
  "file_path",
  "path",
  "pattern",
  "glob",
  "command",
  "query",
  "url",
] as const;

export const MAX_TOOL_TARGET_CHARS = 160;

export function toolTarget(
  parameters: AssessmentRuntimeSummaryValue | undefined,
): string | null {
  if (!isSummaryRecord(parameters)) return null;
  for (const key of TOOL_TARGET_PARAMETER_KEYS) {
    const value = parameters[key];
    if (typeof value === "string" && value.trim().length > 0) {
      const target = value.trim();
      return target.length > MAX_TOOL_TARGET_CHARS
        ? `${target.slice(0, MAX_TOOL_TARGET_CHARS)}…`
        : target;
    }
  }
  return null;
}

export const AI_ACTIVITY_EVENT_TYPES = new Set<string>([
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallStarted,
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallHeartbeat,
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallCompleted,
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallFailed,
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallTimeout,
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelRequest,
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelResult,
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelContentDelta,
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelReasoningDelta,
  // Retrying another credential is part of the same step; switching provider
  // stays its own row because it changes which AI analyses the repository.
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES.credentialRotation,
]);

export function isAiActivityEvent(
  event: AssessmentAgentStreamEvent,
  semantic: SemanticRecord | null,
): boolean {
  return (
    semantic?.kind === ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.reasoningSummary ||
    AI_ACTIVITY_EVENT_TYPES.has(event.eventType)
  );
}

type ModelTurnStep = { key: string; bound: boolean; open: boolean };

/**
 * Resolves each model-related event to ONE logical model turn.
 *
 * The runtime publishes three identities for the same model invocation: the
 * billing wrapper's `model_step_id` (MODEL_CALL_*), LangGraph's `messageId`
 * (MODEL_REQUEST, deltas, semantic output) and nothing at all for
 * CREDENTIAL_ROTATION attempts. Keyed separately they showed as several AI
 * steps. Here `model_step_id` owns the turn; a message binds to the open (else
 * latest) step of its run that has no message yet; credential attempts attach to
 * the open step. Events with no correlatable step keep their own identity, so
 * historical streams without `model_step_id` project exactly as before.
 * ponytail: same-run parallel turns are paired by order, not by a shared id.
 */
export function logicalModelTurnKeys(
  ordered: AssessmentAgentStreamEvent[],
): Map<string, string> {
  const keys = new Map<string, string>();
  const stepsByRun = new Map<string, ModelTurnStep[]>();
  const messageKeys = new Map<string, string>();
  // Exact links first: any event carrying both a model_step_id and a message id
  // (stamped runtime events, or MODEL_CALL_COMPLETED's message_id) binds that
  // message to its step regardless of arrival order. Order-based pairing below
  // is only the fallback for messages with no exact link (historical events).
  for (const event of ordered) {
    const data = isSummaryRecord(event.data) ? event.data : null;
    if (typeof data?.model_step_id !== "string") continue;
    const messageId =
      event.messageId ??
      (typeof data.message_id === "string" ? data.message_id : null);
    if (!messageId) continue;
    messageKeys.set(
      `${event.runId}:${messageId}`,
      `ai:${event.runId}:step:${data.model_step_id}`,
    );
  }
  const boundKeys = new Set(messageKeys.values());
  for (const event of ordered) {
    const semantic = semanticData(event.data);
    if (!isAiActivityEvent(event, semantic)) continue;
    const data = isSummaryRecord(event.data) ? event.data : null;
    const steps = stepsByRun.get(event.runId) ?? [];
    stepsByRun.set(event.runId, steps);
    if (typeof data?.model_step_id === "string") {
      const key = `ai:${event.runId}:step:${data.model_step_id}`;
      let step = steps.find((candidate) => candidate.key === key);
      if (!step) {
        step = { key, bound: boundKeys.has(key), open: false };
        steps.push(step);
      }
      if (event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallStarted) {
        step.open = true;
      } else if (
        event.eventType ===
          ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallCompleted ||
        event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallFailed ||
        event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallTimeout
      ) {
        step.open = false;
      }
      keys.set(event.eventId, key);
      continue;
    }
    if (event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.credentialRotation) {
      const step = steps.filter((candidate) => candidate.open).at(-1) ?? steps.at(-1);
      if (step) keys.set(event.eventId, step.key);
      continue;
    }
    if (!event.messageId) continue;
    const messageKey = `${event.runId}:${event.messageId}`;
    let key = messageKeys.get(messageKey);
    if (!key) {
      const free = steps.filter((candidate) => !candidate.bound);
      const step = free.filter((candidate) => candidate.open).at(-1) ?? free.at(-1);
      if (!step) continue;
      step.bound = true;
      key = step.key;
      messageKeys.set(messageKey, key);
    }
    keys.set(event.eventId, key);
  }
  return keys;
}

export /** Keep one row per model step or streamed message, never per whole chain. */
function aiActivityKey(
  event: AssessmentAgentStreamEvent,
  semantic: SemanticRecord | null,
  resolvedTurnKey?: string,
): string | null {
  if (!isAiActivityEvent(event, semantic)) return null;
  if (resolvedTurnKey) return resolvedTurnKey;
  const data = isSummaryRecord(event.data) ? event.data : null;
  const modelStepId =
    typeof data?.model_step_id === "string" ? data.model_step_id : null;
  const identity = modelStepId
    ? `step:${modelStepId}`
    : event.messageId
      ? `message:${event.messageId}`
      : `event:${event.eventId}`;
  return [
    "ai",
    event.runId,
    event.stage ?? "",
    event.engineeringRuleId ?? "",
    event.agentName ?? "",
    event.namespace.join("/"),
    identity,
  ].join(":");
}

export function applyAiActivity(
  row: ProjectedStreamRow,
  event: AssessmentAgentStreamEvent,
  semantic: SemanticRecord | null,
  streamedText: Map<string, string>,
): void {
  row.sequence = event.sequence;
  row.technical =
    row.id === event.eventId
      ? technicalEventDetails(event)
      : startAndLatestDetails(row.technical, technicalEventDetails(event));
  row.meta = modelCallMeta(event);

  switch (event.eventType) {
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallStarted:
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallHeartbeat:
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelRequest:
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelContentDelta:
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelReasoningDelta:
      row.status = "running";
      row.failed = false;
      break;
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallCompleted:
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelResult:
      row.status = "completed";
      row.failed = false;
      break;
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallFailed:
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallTimeout:
      row.status = "failed";
      row.failed = true;
      break;
    default:
      // Credential rotation, provider fallback and reasoning summaries update
      // the row's content without changing its step status.
      break;
  }
  row.label = activityCopy(
    row.status === "failed"
      ? "aiAnalysisFailed"
      : row.status === "running"
        ? "aiAnalysisRunning"
        : "aiAnalysisCompleted",
  );

  const latestText =
    semantic?.kind === ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.reasoningSummary
      ? reasoningSummaryText(semantic)
      : semantic?.kind === ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.modelOutput
        ? modelOutputText(semantic)
        : streamedDeltaText(event, streamedText);
  if (latestText) row.detail = latestText;
}

export /** Accumulate one message's streamed tokens; the row shows the text so far. */
function streamedDeltaText(
  event: AssessmentAgentStreamEvent,
  streamedText: Map<string, string>,
): string | null {
  if (
    (event.eventType !==
      ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelContentDelta &&
      event.eventType !==
        ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelReasoningDelta) ||
    !event.text
  ) {
    return null;
  }
  const key = [
    event.eventType,
    event.messageId ?? "",
    event.namespace.join("/"),
  ].join(":");
  const text = `${streamedText.get(key) ?? ""}${event.text}`;
  streamedText.set(key, text);
  return text;
}

export function lifecycleEventProgressKey(
  event: AssessmentAgentStreamEvent,
): string | null {
  const namespace = event.namespace.join("/");
  switch (event.eventType) {
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.agentStarted:
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.agentCompleted:
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.agentFailed:
      return [
        "agent",
        event.runId,
        event.stage ?? "",
        event.agentName ?? event.subagentName ?? "agent",
        namespace,
      ].join(":");
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryStarted:
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryCompleted:
    case ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryFailed:
      return [
        "boundary",
        event.runId,
        event.stage ?? "",
        event.source ?? event.agentName ?? "boundary",
        namespace,
      ].join(":");
    default:
      return null;
  }
}

export function runtimeEventType(
  event: AssessmentAgentStreamEvent,
): string | null {
  if (event.eventType !== ASSESSMENT_AGENT_STREAM_EVENT_TYPES.runtimeEvent) {
    return null;
  }
  const data = isSummaryRecord(event.data) ? event.data : null;
  return typeof data?.runtimeEventType === "string"
    ? data.runtimeEventType.toUpperCase()
    : null;
}

export function runtimeEventStatus(
  event: AssessmentAgentStreamEvent,
): StreamRowStatus {
  const type = runtimeEventType(event);
  if (type === "RUN_FAILED" || type === "TOOL_FAILED") return "failed";
  if (type === "RUN_COMPLETED" || type === "TOOL_COMPLETED") {
    return "completed";
  }
  if (type === "RUN_STARTED" || type === "TOOL_STARTED") return "running";
  return streamRowStatus(
    event,
    event.status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed,
  );
}

export function runtimeEventProgressKey(
  event: AssessmentAgentStreamEvent,
): string | null {
  const type = runtimeEventType(event);
  if (
    type !== "RUN_STARTED" &&
    type !== "RUN_COMPLETED" &&
    type !== "RUN_FAILED" &&
    type !== "TOOL_STARTED" &&
    type !== "TOOL_COMPLETED" &&
    type !== "TOOL_FAILED"
  ) {
    return null;
  }
  const data = isSummaryRecord(event.data) ? event.data : null;
  const stage = typeof data?.stage === "string" ? data.stage : "";
  return [
    event.runId,
    event.toolName ?? event.source ?? event.nodeName ?? "runtime",
    stage,
  ].join(":");
}

export function modelCallProgressKey(
  event: AssessmentAgentStreamEvent,
): string | null {
  if (
    event.eventType !== ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallStarted &&
    event.eventType !==
      ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallHeartbeat &&
    event.eventType !==
      ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallCompleted &&
    event.eventType !== ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallFailed &&
    event.eventType !== ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallTimeout
  ) {
    return null;
  }
  const data = isSummaryRecord(event.data) ? event.data : null;
  return [
    event.runId,
    event.agentName ?? "",
    event.nodeName ?? "",
    typeof data?.provider === "string" ? data.provider : "",
    typeof data?.model === "string" ? data.model : "",
    // One row per agent step: without the step identity every model call of a
    // run folds into one ever-growing row.
    typeof data?.model_step_id === "string" ? data.model_step_id : "",
  ].join(":");
}

export function modelOutputText(semantic: SemanticRecord): string | null {
  const result = semantic.resultSummary;
  if (!isSummaryRecord(result)) return null;
  const text = result.text;
  return typeof text === "string" && text.trim().length > 0 ? text : null;
}

export function reasoningSummaryText(semantic: SemanticRecord): string | null {
  const result = semantic.resultSummary;
  if (typeof result === "string") return result;
  if (isSummaryRecord(result)) {
    return firstString(result.summary, result.text, null);
  }
  return null;
}

export function streamEndedWithFailure(
  events: AssessmentAgentStreamEvent[],
): boolean {
  const ordered = [...events].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const latest = ordered.at(-1);
  if (!latest) return false;
  return terminalOutcomesByRun(ordered).get(dispatchKey(latest)) === "failed";
}

export function streamDuration(
  events: AssessmentAgentStreamEvent[],
): string | null {
  const timestamps = events
    .map((event) => Date.parse(event.emittedAt))
    .filter((value) => Number.isFinite(value));
  if (timestamps.length < 2) return null;
  const elapsedSeconds = Math.max(
    0,
    Math.round((Math.max(...timestamps) - Math.min(...timestamps)) / 1000),
  );
  if (elapsedSeconds < 1) return null;
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function streamLabels() {
  return {
    subagent: t("pages.appShell.agentStreamLabels.subagent"),
    agent: t("pages.appShell.agentStreamLabels.agent"),
    flow: t("pages.appShell.agentStreamLabels.flow"),
    reasoning: t("pages.appShell.agentStreamLabels.reasoning"),
    output: t("pages.appShell.agentStreamLabels.output"),
    toolCall: t("pages.appShell.agentStreamLabels.toolCall"),
    toolOutput: t("pages.appShell.agentStreamLabels.toolOutput"),
    log: t("pages.appShell.agentStreamLabels.log"),
    runtime: t("pages.appShell.agentStreamLabels.runtime"),
    progress: t("pages.appShell.agentStreamLabels.progress"),
    update: t("pages.appShell.agentStreamLabels.update"),
    state: t("pages.appShell.agentStreamLabels.state"),
    provider: t("pages.appShell.agentStreamLabels.provider"),
    credential: t("pages.appShell.agentStreamLabels.credential"),
    scanner: t("pages.appShell.agentStreamLabels.scanner"),
    engineeringRule: t("pages.appShell.agentStreamLabels.engineeringRule"),
    skill: t("pages.appShell.agentStreamLabels.skill"),
    model: t("pages.appShell.agentStreamLabels.model"),
    provenance: t("pages.appShell.agentStreamLabels.provenance"),
    selected: t("pages.appShell.agentStreamSelected"),
    loadOlder: t("pages.appShell.agentStreamLoadOlder"),
    loadingOlder: t("pages.appShell.agentStreamLoadingOlder"),
    retryHistory: t("pages.appShell.agentStreamRetryHistory"),
    historyLoadFailed: t("pages.appShell.agentStreamHistoryLoadFailed"),
    running: t("pages.appShell.chatActivityStatuses.running"),
    completed: t("pages.appShell.chatActivityStatuses.completed"),
    failed: t("pages.appShell.chatActivityStatuses.failed"),
    thinking: t("pages.appShell.chatThinking"),
    technicalDetails: t("pages.appShell.agentStreamTechnicalDetails"),
  };
}

export function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
/** A failed rule or provider attempt alone is not a failed outer dispatch. */
export function isAgentStreamDispatchFailed(
  events: AssessmentAgentStreamEvent[],
): boolean {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  let boundaryStage: AssessmentAgentStreamEvent["stage"] | undefined;
  let failed = false;
  for (const event of ordered) {
    if (
      event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryStarted &&
      boundaryStage === undefined
    ) {
      boundaryStage = event.stage;
      failed = false;
    }
    if (runtimeEventType(event) === "RUN_FAILED") failed = true;
    if (
      event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryFailed &&
      (boundaryStage === undefined ||
        event.stage === null ||
        event.stage === boundaryStage)
    )
      failed = true;
  }
  return failed;
}
