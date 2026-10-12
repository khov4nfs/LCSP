import {
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
  type AssessmentLifecycle,
} from "@lcsp/contracts/assessment";
import type { AssessmentRuntime } from "@lcsp/contracts/evidence";
import {
  CUSTOMER_ASSESSMENT_STATES,
  type CustomerAssessmentState,
} from "../config/customer-assessment-states";

/**
 * One customer-facing state from the canonical lifecycle + execution pair. The raw pair stays
 * available under Run details; it is never shown as two competing badges.
 */
export function customerAssessmentState(
  lifecycle: AssessmentLifecycle | null,
  runtime: AssessmentRuntime | null,
): CustomerAssessmentState {
  if (!lifecycle) return CUSTOMER_ASSESSMENT_STATES.UNAVAILABLE;
  switch (lifecycle.state) {
    case ASSESSMENT_LIFECYCLE_STATES.CREATED:
    case ASSESSMENT_LIFECYCLE_STATES.PREPARING:
      return CUSTOMER_ASSESSMENT_STATES.PREPARING;
    case ASSESSMENT_LIFECYCLE_STATES.ACTIVE:
      return runtime?.executionState === AGENT_EXECUTION_STATES.PAUSED ||
        runtime?.executionState === AGENT_EXECUTION_STATES.INTERRUPTED
        ? CUSTOMER_ASSESSMENT_STATES.PAUSED
        : CUSTOMER_ASSESSMENT_STATES.WORKING;
    case ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN:
    case ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_REQUIRED_INPUT:
      return CUSTOMER_ASSESSMENT_STATES.WAITING;
    case ASSESSMENT_LIFECYCLE_STATES.PAUSED:
      return CUSTOMER_ASSESSMENT_STATES.PAUSED;
    case ASSESSMENT_LIFECYCLE_STATES.FINALIZING:
      return CUSTOMER_ASSESSMENT_STATES.FINALIZING;
    case ASSESSMENT_LIFECYCLE_STATES.COMPLETE:
      return CUSTOMER_ASSESSMENT_STATES.COMPLETE;
    case ASSESSMENT_LIFECYCLE_STATES.BLOCKED:
      return CUSTOMER_ASSESSMENT_STATES.BLOCKED;
    case ASSESSMENT_LIFECYCLE_STATES.FAILED:
      return CUSTOMER_ASSESSMENT_STATES.FAILED;
    case ASSESSMENT_LIFECYCLE_STATES.CANCELLED:
      return CUSTOMER_ASSESSMENT_STATES.CANCELLED;
  }
}

/**
 * Whether the Root is executing right now. This is the only source of "animated" UI: a stale
 * event or a stopped/finished/failed run can never leave a spinner behind.
 */
export function isRuntimeRunning(
  lifecycle: AssessmentLifecycle | null,
  runtime: AssessmentRuntime | null,
): boolean {
  if (!lifecycle || !runtime) return false;
  const executing =
    runtime.executionState === AGENT_EXECUTION_STATES.RUNNING ||
    runtime.executionState === AGENT_EXECUTION_STATES.QUEUED;
  return (
    executing &&
    (lifecycle.state === ASSESSMENT_LIFECYCLE_STATES.ACTIVE ||
      lifecycle.state === ASSESSMENT_LIFECYCLE_STATES.FINALIZING)
  );
}
