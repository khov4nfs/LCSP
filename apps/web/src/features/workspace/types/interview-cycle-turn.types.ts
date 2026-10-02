import type { AssessmentInterviewAnswerHistoryItem } from "@lcsp/contracts/evidence";
import type { ReactNode } from "react";

import type { InterviewCycle } from "../utils/agent-stream-stages";

type InterviewCycleActivityProps = {
  activity?: ReactNode;
  /** The activity turn already renders this cycle's output (see
   *  InterviewCycleOutput) above its Technical details, so skip it here. */
  activityOwnsOutput?: boolean;
};

export type InterviewCycleTurnProps =
  | ({ cycle: InterviewCycle } & InterviewCycleActivityProps)
  | ({ answer: AssessmentInterviewAnswerHistoryItem } & InterviewCycleActivityProps);

export type InterviewCycleOutputProps = {
  answer: AssessmentInterviewAnswerHistoryItem;
  question: InterviewCycle["question"];
};
