import {
  AGENT_STREAM_BOUNDARY_TYPES,
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  type AssessmentAgentStreamEvent,
} from "@lcsp/contracts/evidence";
import {
  AGENT_EXECUTION_STATES,
  type AgentExecutionState,
} from "@lcsp/contracts/assessment";
import type { MessageKey } from "@lcsp/i18n";
import {
  CLAIM_DISCOVERY_ACTIVITY_KINDS,
  COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES,
} from "@lcsp/contracts/compliance-rule-set";

const ACTIVITY_KEYS = {
  started: "pages.complianceRuleSets.activity.started",
  loadedSource: "pages.complianceRuleSets.activity.loadedSource",
  claimFileCommitted: "pages.complianceRuleSets.activity.claimFileCommitted",
  readerStarted: "pages.complianceRuleSets.activity.readerStarted",
  readingSource: "pages.complianceRuleSets.activity.readingSource",
  searchingSource: "pages.complianceRuleSets.activity.searchingSource",
  inspectingSource: "pages.complianceRuleSets.activity.inspectingSource",
  readerCompleted: "pages.complianceRuleSets.activity.readerCompleted",
  modelTurn: "pages.complianceRuleSets.activity.modelTurn",
  synthesizing: "pages.complianceRuleSets.activity.synthesizing",
  validating: "pages.complianceRuleSets.activity.validating",
  validationPassed: "pages.complianceRuleSets.activity.validationPassed",
  validationFailed: "pages.complianceRuleSets.activity.validationFailed",
  submitting: "pages.complianceRuleSets.activity.submitting",
  sourceBlocked: "pages.complianceRuleSets.activity.sourceBlocked",
  completed: "pages.complianceRuleSets.activity.completed",
  executionFinished: "pages.complianceRuleSets.activity.executionFinished",
  failed: "pages.complianceRuleSets.activity.failed",
  cancelled: "pages.complianceRuleSets.activity.cancelled",
  paused: "pages.complianceRuleSets.activity.paused",
} as const satisfies Record<string, MessageKey>;

const EVENT_TYPES = ASSESSMENT_AGENT_STREAM_EVENT_TYPES;
const ACTIVITY_STATUSES = {
  running: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
  completed: ASSESSMENT_RUNTIME_RUN_STATUSES.completed,
  failed: ASSESSMENT_RUNTIME_RUN_STATUSES.failed,
  cancelled: AGENT_EXECUTION_STATES.CANCELLED,
  paused: AGENT_EXECUTION_STATES.PAUSED,
} as const;
type PreparationActivityStatus =
  (typeof ACTIVITY_STATUSES)[keyof typeof ACTIVITY_STATUSES];

export type PreparationActivity = {
  id: string;
  labelKey: MessageKey;
  status: PreparationActivityStatus;
  event: AssessmentAgentStreamEvent;
  details: PreparationActivityDetails;
};

export type PreparationActivityDetails = {
  agent: string | null;
  subagent: string | null;
  provider: string | null;
  model: string | null;
  nativeTool: string | null;
  runId: string;
  toolCallId: string | null;
  modelStepId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  sourcePath: string | null;
  claimFile: string | null;
  committedNodes: number | null;
  rejected: number | null;
};

export type PreparationTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

type ActivityDraft = PreparationActivity;

export function projectPreparationActivity(
  events: AssessmentAgentStreamEvent[],
  terminal = false,
  executionState: AgentExecutionState | null = null,
): PreparationActivity[] {
  const drafts: ActivityDraft[] = [];
  const byId = new Map<string, ActivityDraft>();
  const ordered = [...events]
    .filter(
      (event) =>
        event.boundaryType === AGENT_STREAM_BOUNDARY_TYPES.ruleSetPreparation ||
        event.preparationRunId !== null,
    )
    .sort((left, right) => left.sequence - right.sequence);

  for (const event of ordered) {
    const data = record(event.data);
    const tool = event.toolName ?? stringValue(data?.native_tool);
    const modelStepId = stringValue(data?.model_step_id);
    const toolId = event.toolCallId;
    const existingId = toolId ?? modelStepId;
    const status = statusOf(event.status);

    if (event.eventType === EVENT_TYPES.boundaryStarted) {
      add(drafts, byId, activity(event, ACTIVITY_KEYS.started, status));
      continue;
    }
    if (event.eventType === EVENT_TYPES.boundaryCompleted) {
      const outcome =
        executionState === AGENT_EXECUTION_STATES.PAUSED
          ? { key: ACTIVITY_KEYS.paused, status: ACTIVITY_STATUSES.paused }
          : executionState === AGENT_EXECUTION_STATES.SUCCEEDED
            ? {
                key: ACTIVITY_KEYS.completed,
                status: ACTIVITY_STATUSES.completed,
              }
            : executionState === AGENT_EXECUTION_STATES.FAILED
              ? { key: ACTIVITY_KEYS.failed, status: ACTIVITY_STATUSES.failed }
              : executionState === AGENT_EXECUTION_STATES.CANCELLED
                ? {
                    key: ACTIVITY_KEYS.cancelled,
                    status: ACTIVITY_STATUSES.cancelled,
                  }
                : {
                    key: ACTIVITY_KEYS.executionFinished,
                    status: ACTIVITY_STATUSES.completed,
                  };
      add(drafts, byId, activity(event, outcome.key, outcome.status));
      continue;
    }
    if (event.eventType === EVENT_TYPES.boundaryFailed) {
      add(
        drafts,
        byId,
        activity(
          event,
          executionState === AGENT_EXECUTION_STATES.PAUSED
            ? ACTIVITY_KEYS.paused
            : ACTIVITY_KEYS.failed,
          executionState === AGENT_EXECUTION_STATES.PAUSED
            ? ACTIVITY_STATUSES.paused
            : ACTIVITY_STATUSES.failed,
        ),
      );
      continue;
    }
    if (event.eventType === EVENT_TYPES.preparationCancelled) {
      add(
        drafts,
        byId,
        activity(event, ACTIVITY_KEYS.cancelled, ACTIVITY_STATUSES.cancelled),
      );
      continue;
    }
    if (event.eventType === EVENT_TYPES.customProgress) {
      const key = stringValue(data?.activity_kind);
      if (key === CLAIM_DISCOVERY_ACTIVITY_KINDS.SOURCE_MATERIALIZED) {
        add(
          drafts,
          byId,
          activity(
            event,
            ACTIVITY_KEYS.loadedSource,
            ACTIVITY_STATUSES.completed,
          ),
        );
      }
      if (key === CLAIM_DISCOVERY_ACTIVITY_KINDS.PREPARATION_PAUSED) {
        add(
          drafts,
          byId,
          activity(event, ACTIVITY_KEYS.paused, ACTIVITY_STATUSES.paused),
        );
      }
      if (
        key === CLAIM_DISCOVERY_ACTIVITY_KINDS.CLAIM_FILE_COMMITTED &&
        stringValue(data?.file)
      ) {
        const next = activity(
          event,
          ACTIVITY_KEYS.claimFileCommitted,
          ACTIVITY_STATUSES.completed,
          {
            claimFile: stringValue(data?.file),
            committedNodes: countOrNull(data?.committedNodes),
            rejected: countOrNull(data?.rejected),
          },
        );
        // Re-commits replace the file row; counters remain a snapshot, never a sum of retries.
        next.id = `claim-file:${next.details.claimFile}`;
        mergeActivity(drafts, byId, next.id, next);
      }
      continue;
    }
    if (
      event.eventType === EVENT_TYPES.modelCallStarted ||
      event.eventType === EVENT_TYPES.modelCallCompleted
    ) {
      const next = activity(event, ACTIVITY_KEYS.modelTurn, status);
      mergeActivity(drafts, byId, existingId, next);
      continue;
    }
    if (
      event.eventType === EVENT_TYPES.semanticToolCall ||
      event.eventType === EVENT_TYPES.toolResult
    ) {
      const label = toolLabel(tool, event.eventType, data);
      if (label === null) continue;
      const next = activity(event, label.key, status, {
        subagent: stringValue(data?.subagent_type) ?? event.subagentName,
      });
      mergeActivity(drafts, byId, existingId, next);
    }
  }

  if (terminal) {
    const terminalStatus =
      executionState === AGENT_EXECUTION_STATES.PAUSED
        ? ACTIVITY_STATUSES.paused
        : executionState === AGENT_EXECUTION_STATES.FAILED
          ? ACTIVITY_STATUSES.failed
          : executionState === AGENT_EXECUTION_STATES.CANCELLED
            ? ACTIVITY_STATUSES.cancelled
            : ACTIVITY_STATUSES.completed;
    for (const draft of drafts) {
      if (draft.status === ACTIVITY_STATUSES.running) {
        draft.status = terminalStatus;
      }
    }
  }
  return drafts;
}

export function preparationTokenUsage(
  events: AssessmentAgentStreamEvent[],
): PreparationTokenUsage {
  const seen = new Set<string>();
  const total: PreparationTokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
  for (const event of events) {
    if (event.eventType !== EVENT_TYPES.modelCallCompleted) continue;
    const data = record(event.data);
    const usage = record(data?.usage);
    const identity =
      stringValue(data?.invocation_id) ??
      stringValue(data?.model_step_id) ??
      event.messageId ??
      event.eventId;
    if (seen.has(identity)) continue;
    seen.add(identity);
    total.inputTokens += numberValue(usage?.input_tokens);
    total.outputTokens += numberValue(usage?.output_tokens);
    total.totalTokens += numberValue(usage?.total_tokens);
  }
  return total;
}

export function preparationModelCalls(events: AssessmentAgentStreamEvent[]): number {
  return new Set(events.filter((e) => e.eventType === EVENT_TYPES.modelCallStarted || e.eventType === EVENT_TYPES.modelCallCompleted).map((event) => {
    const data = record(event.data);
    return stringValue(data?.invocation_id) ?? stringValue(data?.model_step_id) ?? event.messageId ?? event.eventId;
  })).size;
}

export type PreparationProgressSummary = {
  reviewed: number;
  total: number;
  remaining: number | null;
  reviewedWithClaims: number | null;
  reviewedNoClaims: number | null;
  inReview: number | null;
  pending: number | null;
  blocked: number | null;
  persistedClaims: number | null;
  claims: number | null;
  requirements: number | null;
  rules: number | null;
};

/** Display only counters emitted by the selected run; absent telemetry is not zero progress. */
export function preparationProgress(
  events: AssessmentAgentStreamEvent[],
): PreparationProgressSummary | null {
  for (const event of [...events].sort((a, b) => b.sequence - a.sequence)) {
    if (
      event.eventType !== EVENT_TYPES.customProgress ||
      event.preparationRunId === null
    )
      continue;
    const data = record(event.data);
    const progress = record(record(data?.review_frontier)?.progress);
    const total = numberOrNull(progress?.total);
    const verifiedFrontier =
      (numberOrNull(progress?.reviewedWithClaims) ?? 0) +
      (numberOrNull(progress?.reviewedNoClaims) ?? 0);
    const reviewed = Math.max(
      numberOrNull(data?.source_nodes_reviewed) ?? 0,
      verifiedFrontier,
    );
    if (total === null) continue;
    return {
      reviewed,
      total,
      remaining:
        progress?.pending !== undefined
          ? numberValue(progress.pending) +
            numberValue(progress.inReview) +
            numberValue(progress.blocked)
          : numberOrNull(data?.source_nodes_remaining),
      reviewedWithClaims: numberOrNull(progress?.reviewedWithClaims),
      reviewedNoClaims: numberOrNull(progress?.reviewedNoClaims),
      inReview: numberOrNull(progress?.inReview),
      pending: numberOrNull(progress?.pending),
      blocked: numberOrNull(progress?.blocked),
      persistedClaims: numberOrNull(progress?.persistedClaims),
      claims: numberOrNull(data?.claim_count),
      requirements: numberOrNull(data?.requirement_count),
      rules: numberOrNull(data?.assessment_rule_count),
    };
  }
  return null;
}

function toolLabel(
  tool: string | null,
  eventType: string,
  data: Record<string, unknown> | null,
): { key: MessageKey } | null {
  if (tool === "task") {
    const reader = stringValue(data?.subagent_type) === "legal-source-reader";
    return {
      key:
        eventType === EVENT_TYPES.toolResult && reader
          ? ACTIVITY_KEYS.readerCompleted
          : reader
            ? ACTIVITY_KEYS.readerStarted
            : ACTIVITY_KEYS.synthesizing,
    };
  }
  if (tool === "read_file") return { key: ACTIVITY_KEYS.readingSource };
  if (tool === "grep") return { key: ACTIVITY_KEYS.searchingSource };
  if (tool === "ls" || tool === "glob") {
    return { key: ACTIVITY_KEYS.inspectingSource };
  }
  if (tool === "validate_compliance_rule_set") {
    return {
      key:
        stringValue(data?.outcome) ===
        COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES.PASSED
          ? ACTIVITY_KEYS.validationPassed
          : eventType === EVENT_TYPES.toolResult && stringValue(data?.outcome)
            ? ACTIVITY_KEYS.validationFailed
            : ACTIVITY_KEYS.validating,
    };
  }
  if (tool === "submit_compliance_rule_set") {
    return { key: ACTIVITY_KEYS.submitting };
  }
  if (tool === "report_rule_set_source_blocked") {
    return { key: ACTIVITY_KEYS.sourceBlocked };
  }
  return null;
}

function activity(
  event: AssessmentAgentStreamEvent,
  labelKey: MessageKey,
  status: PreparationActivity["status"],
  overrides: Partial<PreparationActivityDetails> = {},
): ActivityDraft {
  return {
    id:
      event.toolCallId ??
      stringValue(record(event.data)?.model_step_id) ??
      event.eventId,
    labelKey,
    status,
    event,
    details: {
      agent: stringValue(record(event.data)?.agent_role) ?? event.agentName,
      subagent: event.subagentName,
      provider: stringValue(record(event.data)?.provider),
      model: stringValue(record(event.data)?.model),
      nativeTool:
        event.toolName ?? stringValue(record(event.data)?.native_tool),
      runId: event.runId,
      toolCallId: event.toolCallId,
      modelStepId: stringValue(record(event.data)?.model_step_id),
      inputTokens: numberOrNull(
        record(record(event.data)?.usage)?.input_tokens,
      ),
      outputTokens: numberOrNull(
        record(record(event.data)?.usage)?.output_tokens,
      ),
      totalTokens: numberOrNull(
        record(record(event.data)?.usage)?.total_tokens,
      ),
      sourcePath: stringValue(record(event.data)?.source_path),
      claimFile: null,
      committedNodes: null,
      rejected: null,
      ...overrides,
    },
  };
}

function mergeActivity(
  drafts: ActivityDraft[],
  byId: Map<string, ActivityDraft>,
  id: string | null,
  next: ActivityDraft,
) {
  if (!id) {
    add(drafts, byId, next);
    return;
  }
  const current = byId.get(id);
  if (!current) {
    add(drafts, byId, next);
    return;
  }
  current.status = next.status;
  current.event = next.event;
  current.details = {
    ...current.details,
    ...Object.fromEntries(
      Object.entries(next.details).filter(([, value]) => value !== null),
    ),
  } as PreparationActivityDetails;
  if (next.labelKey !== ACTIVITY_KEYS.modelTurn)
    current.labelKey = next.labelKey;
}

function add(
  drafts: ActivityDraft[],
  byId: Map<string, ActivityDraft>,
  next: ActivityDraft,
) {
  drafts.push(next);
  byId.set(next.id, next);
}

function record(value: unknown) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function statusOf(value: string | null): PreparationActivity["status"] {
  if (value === ACTIVITY_STATUSES.failed) return ACTIVITY_STATUSES.failed;
  if (value === ACTIVITY_STATUSES.completed) {
    return ACTIVITY_STATUSES.completed;
  }
  return ACTIVITY_STATUSES.running;
}

function countOrNull(value: unknown): number | null {
  return Array.isArray(value)
    ? value.length
    : record(value)
      ? Object.keys(value as Record<string, unknown>).length
      : numberOrNull(value);
}
