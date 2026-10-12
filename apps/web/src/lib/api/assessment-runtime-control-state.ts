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

/** A slow request response cannot overwrite a newer runtime acknowledgement. */
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
  return order[current.state] > order[response.state] ? current : response;
}
