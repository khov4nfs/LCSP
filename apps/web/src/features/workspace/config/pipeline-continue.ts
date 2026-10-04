import { ASSESSMENT_STATUS_CODES } from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_PIPELINE_CONTINUE_ACTIONS,
  type AssessmentPipelineContinueAction,
} from "@lcsp/contracts/evidence";

import type { AssessmentPipelineContinueOutcome } from "@/lib/api/assessment-interview-client";
import { API_OUTCOME_KINDS } from "@/lib/api/outcome-kinds";

import type { AssessmentStatus } from "../types/workspace.types";

/** Assessment statuses with no pipeline step left to continue. */
export const PIPELINE_CONTINUE_FINISHED_STATUSES: ReadonlySet<AssessmentStatus> =
  new Set([
    ASSESSMENT_STATUS_CODES.aiNotDetected,
    ASSESSMENT_STATUS_CODES.readyForReview,
  ]);

const CONTINUE_ACTION_MESSAGE_KEYS: Record<
  AssessmentPipelineContinueAction,
  string
> = {
  [ASSESSMENT_PIPELINE_CONTINUE_ACTIONS.interviewTurnResumed]:
    "pages.assessmentFlow.interview.resumeTurnQueued",
  [ASSESSMENT_PIPELINE_CONTINUE_ACTIONS.downstreamRequeued]:
    "pages.assessmentFlow.pipeline.continueQueued",
  [ASSESSMENT_PIPELINE_CONTINUE_ACTIONS.checkpointResumeRequested]:
    "pages.appShell.chatContinuingTurn",
};

const CONTINUE_OUTCOME_MESSAGE_KEYS: Record<string, string> = {
  [API_OUTCOME_KINDS.alreadyRunning]:
    "pages.assessmentFlow.pipeline.continueAlreadyRunning",
  [API_OUTCOME_KINDS.waitingForCustomer]:
    "pages.assessmentFlow.pipeline.continueWaitingForCustomer",
  [API_OUTCOME_KINDS.completed]:
    "pages.assessmentFlow.pipeline.continueCompleted",
  [API_OUTCOME_KINDS.rateLimited]:
    "pages.assessmentFlow.interview.resumeTurnLimitReached",
};

export const PIPELINE_CONTINUE_FAILED_MESSAGE_KEY =
  "pages.assessmentFlow.pipeline.continueFailed";

/** Resolve the customer-facing message key for one Continue outcome. */
export function pipelineContinueMessageKey(
  outcome: AssessmentPipelineContinueOutcome,
): string {
  if (outcome.kind === API_OUTCOME_KINDS.requested) {
    return CONTINUE_ACTION_MESSAGE_KEYS[outcome.action];
  }
  return (
    CONTINUE_OUTCOME_MESSAGE_KEYS[outcome.kind] ??
    PIPELINE_CONTINUE_FAILED_MESSAGE_KEY
  );
}
