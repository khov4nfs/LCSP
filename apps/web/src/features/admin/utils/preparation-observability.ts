import { AGENT_EXECUTION_STATES } from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES as E,
  ASSESSMENT_RUNTIME_RUN_STATUSES as S,
  type AssessmentAgentStreamEvent,
} from "@lcsp/contracts/evidence";
import {
  CLAIM_PREPARATION_PHASES,
  CLAIM_DISCOVERY_ACTIVITY_KINDS as A,
  COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES as V,
} from "@lcsp/contracts/compliance-rule-set";
import {
  PREPARATION_OBSERVABILITY_STAGES,
  PREPARATION_STAGE_OBSERVATIONS as O,
} from "../config/preparation-activity.config";
import type { RuleSetPreparationRow } from "../types/compliance-rule-sets.types";
import { preparationProgress } from "./rule-set-preparation-activity";
/**
 * Business purpose: Project only allowlisted identifiers from sanitized runner failure telemetry.
 * Business rules:
 * - No raw messages, stack, provider error, prompt or reasoning is displayed; diagnostic strings must be bounded identifiers.
 * Execution flow:
 * 1. Find the latest matching failure and extract known safe metadata fields.
 * Failure cases:
 * - Missing or malformed fields remain unavailable rather than interpolated as error bodies.
 * Side effects:
 * - None: read-only presentation projection.
 */
export function preparationFailure(events: AssessmentAgentStreamEvent[]) {
  const event = [...events]
    .sort((a, b) => b.sequence - a.sequence)
    .find((e) => object(e.data)?.activity_kind === A.PREPARATION_FAILURE);
  if (!event) return null;
  const data = object(event.data);
  const model = object(data?.last_completed_model_call);
  const failing = object(data?.failing_model_call);
  return {
    stage: identifier(data?.terminal_stage),
    category: identifier(data?.safe_error_category),
    code: identifier(data?.callback_code),
    exceptionClass: identifier(data?.exception_class),
    reason: identifier(data?.failure_reason),
    failingModel:
      [identifier(failing?.provider), identifier(failing?.model)]
        .filter(Boolean)
        .join(" / ") || null,
    operation: identifier(failing?.operation_type),
    retryability: identifier(failing?.retryability),
    callbackStatus:
      typeof data?.callback_status === "number" &&
      Number.isSafeInteger(data.callback_status)
        ? String(data.callback_status)
        : null,
    attempt:
      typeof failing?.attempt_ordinal === "number" &&
      Number.isSafeInteger(failing.attempt_ordinal)
        ? String(failing.attempt_ordinal)
        : null,
    lastSuccess:
      [...events]
        .sort((a, b) => b.sequence - a.sequence)
        .find(
          (event) =>
            (event.eventType === E.modelCallCompleted ||
              event.eventType === E.toolResult) &&
            event.status === S.completed,
        )?.emittedAt ?? null,
    lastModel:
      [
        identifier(model?.provider),
        identifier(model?.model),
        identifier(model?.invocation_id),
      ]
        .filter(Boolean)
        .join(" / ") || null,
    activeTools: Array.isArray(data?.active_tool_names)
      ? data.active_tool_names
          .flatMap((v) => (identifier(v) ? [identifier(v)!] : []))
          .slice(0, 30)
          .join(", ")
      : null,
  };
}
/**
 * Business purpose: Describe stage evidence without inventing run or legal approval states.
 * Business rules:
 * - Exact known tool/event/phase evidence is required; absent evidence remains NOT_REPORTED.
 * Execution flow:
 * 1. Resolve each presentation stage from canonical draft/phase and corresponding emitted events.
 * Failure cases:
 * - Incomplete counts or missing events cannot certify a completed stage.
 * Side effects:
 * - None: presentation only, never activation authority.
 */
export function preparationStages(
  run: RuleSetPreparationRow,
  events: AssessmentAgentStreamEvent[],
) {
  const status = new Map<string, (typeof O)[keyof typeof O]>(
    PREPARATION_OBSERVABILITY_STAGES.map((stage) => [
      stage,
      run.executionState === AGENT_EXECUTION_STATES.QUEUED &&
      run.startedAt === null &&
      !events.length
        ? O.NOT_STARTED
        : O.NOT_REPORTED,
    ]),
  );
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  for (const event of ordered) {
    const data = object(event.data);
    const tool = event.toolName;
    if (data?.activity_kind === A.SOURCE_MATERIALIZED)
      status.set("SOURCE_LOADING", O.COMPLETED);
    if (tool && ["read_file", "grep", "glob", "ls"].includes(tool))
      status.set("SOURCE_DISCOVERY", O.RUNNING);
    if (data?.activity_kind === A.CLAIM_FILE_COMMITTED)
      status.set("CLAIM_INVENTORY", O.RUNNING);
    if (tool === "validate_compliance_rule_set")
      status.set(
        "RULE_VALIDATION",
        data?.outcome === V.FAILED
          ? O.FAILED
          : data?.outcome === V.PASSED
            ? O.COMPLETED
            : O.RUNNING,
      );
    if (tool === "submit_compliance_rule_set")
      status.set("SUBMISSION", O.RUNNING);
  }
  const progress = preparationProgress(events);
  if (progress && !progress.inconsistent) {
    if (progress.blocked && progress.blocked > 0)
      status.set("SOURCE_REVIEW", O.BLOCKED);
    else if (
      progress.reviewed !== null &&
      progress.total > 0 &&
      progress.reviewed === progress.total
    )
      status.set("SOURCE_REVIEW", O.COMPLETED);
    else if (progress.inReview && progress.inReview > 0)
      status.set("SOURCE_REVIEW", O.RUNNING);
  }
  if (run.claimPhase === CLAIM_PREPARATION_PHASES.RULE_AUTHORING) {
    status.set("CLAIM_INVENTORY", O.COMPLETED);
    status.set("SOURCE_DISCOVERY", O.COMPLETED);
    status.set(
      "RULE_AUTHORING",
      run.draft?.validation?.outcome === V.PASSED ? O.COMPLETED : O.RUNNING,
    );
  }
  if (
    run.executionState === AGENT_EXECUTION_STATES.SUCCEEDED &&
    run.ruleSetVersionId
  )
    status.set("SUBMISSION", O.COMPLETED);
  if (run.draft?.assessmentsCanUseRuleSet)
    status.set("ACTIVATION", O.COMPLETED);
  for (const [stage, value] of status)
    if (
      value === O.RUNNING &&
      run.executionState !== AGENT_EXECUTION_STATES.RUNNING
    )
      status.set(
        stage,
        run.executionState === AGENT_EXECUTION_STATES.PAUSED
          ? O.PAUSED
          : O.NOT_REPORTED,
      );
  return PREPARATION_OBSERVABILITY_STAGES.map((stage) => ({
    stage,
    status: status.get(stage)!,
  }));
}
/**
 * Business purpose: Read a telemetry object without coercing untrusted arrays or primitives.
 * Business rules:
 * - Only ordinary record-like data may supply allowlisted fields.
 * Execution flow:
 * 1. Reject non-object and array inputs.
 * Failure cases:
 * - Invalid metadata returns null.
 * Side effects:
 * - None: returns a nullable value without changing telemetry or runtime state.
 */
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
/**
 * Business purpose: Bound safe diagnostic identity display.
 * Business rules:
 * - Identifiers contain no whitespace, markup, message body or authorization material.
 * Execution flow:
 * 1. Match a conservative identifier alphabet and length.
 * Failure cases:
 * - Unsupported input remains null.
 * Side effects:
 * - None: returns a nullable value without changing telemetry or runtime state.
 */
function identifier(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_.:/-]{1,128}$/.test(value)
    ? value
    : null;
}
