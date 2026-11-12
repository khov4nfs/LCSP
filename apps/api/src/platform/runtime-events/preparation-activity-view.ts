import {
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES as E,
  type AssessmentAgentStreamEvent,
  type AssessmentRuntimeSummaryValue,
} from "@lcsp/contracts/evidence";
import { sanitizeAgentStreamValue } from "./agent-stream-sanitizer.js";
export const PREPARATION_VISIBLE_EVENT_TYPES = [
  E.boundaryStarted,
  E.boundaryCompleted,
  E.boundaryFailed,
  E.customProgress,
  E.semanticToolCall,
  E.toolResult,
  E.modelCallStarted,
  E.modelCallCompleted,
  E.modelCallFailed,
  E.modelCallCancelled,
  E.modelCallTimeout,
  E.modelCallHeartbeat,
  E.preparationCancelled,
];
const visible = new Set<string>(PREPARATION_VISIBLE_EVENT_TYPES);
const scalarKeys = [
  "activity_kind",
  "failure_reason",
  "terminal_stage",
  "safe_error_category",
  "exception_class",
  "callback_status",
  "callback_code",
  "native_tool",
  "subagent_type",
  "agent_role",
  "provider",
  "model",
  "model_step_id",
  "invocation_id",
  "outcome",
  "source_path",
  "file",
  "committedNodes",
  "rejected",
  "source_nodes_reviewed",
  "source_nodes_remaining",
  "claim_count",
  "requirement_count",
  "assessment_rule_count",
  "reason",
];
const usageKeys = ["input_tokens", "output_tokens", "total_tokens"];
const modelKeys = [
  "provider",
  "model",
  "operation_type",
  "model_step_id",
  "invocation_id",
  "http_status",
  "retryability",
  "fallback_eligibility",
  "attempt_ordinal",
  "route_ordinal",
  "credential_slot_safe_id",
  "last_attempt_error_class",
  "last_attempt_http_status",
];
/**
 * Business purpose: Expose minimal Preparation operations telemetry without prompts, reasoning or source bodies.
 * Business rules:
 * - Only event identity, known operational kinds and allowlisted scalar metadata leave the journal; raw text is always removed.
 * Execution flow:
 * 1. Reject content/private event kinds and select bounded sanitized counters, tool identities and failure metadata.
 * Failure cases:
 * - Malformed metadata is omitted rather than serialized as arbitrary provider or legal content.
 * Side effects:
 * - None: canonical journal bytes remain unchanged.
 */
export function preparationActivityView(
  event: AssessmentAgentStreamEvent,
): AssessmentAgentStreamEvent | null {
  if (!visible.has(event.eventType)) return null;
  const source = record(event.data);
  const data: Record<string, AssessmentRuntimeSummaryValue> = {
    ...scalars(source, scalarKeys),
  };
  for (const key of [
    "failing_model_call",
    "last_completed_model_call",
    "active_model_call",
  ])
    if (record(source?.[key]))
      data[key] = scalars(record(source?.[key]), modelKeys);
  if (record(source?.usage))
    data.usage = scalars(record(source?.usage), usageKeys);
  const frontier = record(record(source?.review_frontier)?.progress);
  if (frontier)
    data.review_frontier = {
      progress: scalars(frontier, [
        "total",
        "reviewedWithClaims",
        "reviewedNoClaims",
        "inReview",
        "pending",
        "blocked",
        "persistedClaims",
      ]),
    };
  if (Array.isArray(source?.active_tool_names))
    data.active_tool_names = source.active_tool_names
      .filter(
        (value): value is string =>
          typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value),
      )
      .slice(0, 30);
  return {
    ...event,
    text: null,
    data: Object.keys(data).length ? sanitizeAgentStreamValue(data) : null,
  };
}
/**
 * Business purpose: Inspect metadata records without coercing arbitrary payloads.
 * Business rules:
 * - Arrays and primitives cannot supply diagnostic fields.
 * Execution flow:
 * 1. Accept only non-array objects.
 * Failure cases:
 * - Invalid shapes return null.
 * Side effects:
 * - None: read-only metadata access.
 */
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
/**
 * Business purpose: Select safe diagnostic scalar values from an allowlisted schema.
 * Business rules:
 * - Objects and message bodies are excluded; strings and numbers remain bounded and sanitized.
 * Execution flow:
 * 1. Keep named primitive fields and invoke the existing credential/private-data sanitizer.
 * Failure cases:
 * - Unsupported values are omitted.
 * Side effects:
 * - None: returns a new metadata object.
 */
function scalars(
  source: Record<string, unknown> | null,
  keys: string[],
): Record<string, AssessmentRuntimeSummaryValue> {
  const output: Record<string, AssessmentRuntimeSummaryValue> = {};
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "string")
      output[key] = sanitizeAgentStreamValue(value.slice(0, 256));
    else if (
      (typeof value === "number" && Number.isFinite(value)) ||
      typeof value === "boolean"
    )
      output[key] = value;
  }
  return output;
}
