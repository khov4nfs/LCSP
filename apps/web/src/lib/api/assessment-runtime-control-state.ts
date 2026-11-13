import {
  ASSESSMENT_RUNTIME_CONTROL_STATES as States,
  type AssessmentRuntimeControlResult,
} from "@lcsp/contracts/evidence";

const order = {
  [States.running]: 0,
  [States.stopRequested]: 1,
  [States.stopped]: 2,
  [States.resumeRequested]: 3,
  [States.completed]: 4,
};

/**
 * Business purpose:
 * Reconcile in-flight mutation responses, background polling responses, and SSE event acknowledgements
 * so that stale asynchronous responses cannot overwrite newer runtime control states or newer target runs.
 *
 * Business rules:
 * - A newer targetRunId registered in the client (or received via SSE) must not be replaced by a late response
 *   from an older, cancelled execution generation.
 * - An in-flight mutation (with targetRunId and previousTargetRunId fencing) may advance an unchanged older cache
 *   to the newly acknowledged targetRunId.
 * - Within the same targetRunId, terminal COMPLETED state takes immutable precedence over any other state.
 * - A successful worker resumption (RUNNING) takes precedence over an in-flight RESUME_REQUESTED state.
 * - Delayed responses representing superseded prior steps (e.g. STOP_REQUESTED when already STOPPED,
 *   or RESUME_REQUESTED when already RUNNING) must be discarded.
 *
 * Execution flow:
 * 1. If current cache is empty, return the incoming response.
 * 2. If response is null, preserve the current cache.
 * 3. If targetRunId differs:
 *    a. If this is a tracked mutation advancing previousTargetRunId to targetRunId, accept response.
 *    b. Otherwise, preserve current cache to prevent older generation responses from overwriting newer runs.
 * 4. If current is COMPLETED, keep current (terminal invariant).
 * 5. If response is COMPLETED, return response (completion always advances).
 * 6. If current is RESUME_REQUESTED and response is RUNNING, return response (resumption acknowledged).
 * 7. If current is RUNNING and response is RESUME_REQUESTED, keep current (stale request discarded).
 * 8. Otherwise, apply state precedence order to reject regressions.
 *
 * Failure cases:
 * - Null or undefined inputs fail open to the available valid state representation.
 *
 * Side effects:
 * - Pure cache merge function; does not mutate input objects.
 */
export function mergeRuntimeControlResponse(
  current: AssessmentRuntimeControlResult | null | undefined,
  response: AssessmentRuntimeControlResult | null,
  request?: { targetRunId?: string; previousTargetRunId?: string },
): AssessmentRuntimeControlResult | null {
  if (!current) return response;
  if (!response) return current;
  if (current.targetRunId !== response.targetRunId) {
    // SSE can identify the new active generation before its control poll. Its
    // own mutation response may advance that unchanged older cache, but cannot
    // replace a generation registered while the request was in flight.
    return request &&
      current.targetRunId === request.previousTargetRunId &&
      (request.targetRunId === undefined ||
        response.targetRunId === request.targetRunId)
      ? response
      : current;
  }
  if (current.state === States.completed) {
    return current;
  }
  if (response.state === States.completed) {
    return response;
  }
  if (
    current.state === States.resumeRequested &&
    response.state === States.running
  ) {
    return response;
  }
  if (
    current.state === States.running &&
    response.state === States.resumeRequested
  ) {
    return current;
  }
  return order[current.state] > order[response.state] ? current : response;
}
