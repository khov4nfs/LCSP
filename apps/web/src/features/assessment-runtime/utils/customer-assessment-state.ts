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
 * Business purpose: Present one customer-facing Assessment state from its canonical lifecycle
 * and execution, including runs that fail while the Assessment remains active.
 *
 * Business rules:
 * - An ACTIVE Assessment with a FAILED execution displays failure.
 * - Paused and interrupted executions display pause; other lifecycle states retain their meaning.
 *
 * Execution flow:
 * 1. Return unavailable when the lifecycle is absent.
 * 2. Resolve failed or paused executions within an active Assessment.
 * 3. Map the remaining lifecycle states to their customer-facing states.
 *
 * Failure cases:
 * - Missing lifecycle data displays unavailable.
 * - A failed active execution must not display working or leave the interaction bar spinning.
 *
 * Side effects:
 * - Pure projection; does not change persisted state or initiate a retry.
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
      if (runtime?.executionState === AGENT_EXECUTION_STATES.FAILED) {
        return CUSTOMER_ASSESSMENT_STATES.FAILED;
      }
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
