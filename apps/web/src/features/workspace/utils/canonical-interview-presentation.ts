import {
  ASSESSMENT_INTERVIEW_OUTCOMES,
  type AssessmentInterviewOutcome,
} from "@lcsp/contracts/evidence";
import type {
  NormalizedAssessmentInterview,
  NormalizedCustomerActions,
} from "../types/assessment-runtime-adapter.types";
import type {
  AssessmentInterviewAnswerHistoryItem,
  AssessmentInterviewQuestion,
} from "@lcsp/contracts/evidence";
import { ASSESSMENT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";

export const CANONICAL_INTERVIEW_PRESENTATION_STATES = {
  hidden: "HIDDEN",
  readOnly: "READ_ONLY",
  interactiveEligible: "INTERACTIVE_ELIGIBLE",
} as const;

export type CanonicalInterviewPresentationState =
  (typeof CANONICAL_INTERVIEW_PRESENTATION_STATES)[keyof typeof CANONICAL_INTERVIEW_PRESENTATION_STATES];

export type CanonicalInterviewPresentation = {
  state: CanonicalInterviewPresentationState;
  activeQuestion: AssessmentInterviewQuestion | null;
  answerHistory: AssessmentInterviewAnswerHistoryItem[];
  interviewOutcome: AssessmentInterviewOutcome | null;
};

type CanonicalInterviewPresentationInput = {
  lifecycleState: (typeof ASSESSMENT_LIFECYCLE_STATES)[keyof typeof ASSESSMENT_LIFECYCLE_STATES] | null;
  interview: Pick<
    NormalizedAssessmentInterview,
    | "outcome"
    | "activeQuestion"
    | "answerHistory"
    | "stale"
    | "revalidating"
  >;
  customerActions: Pick<NormalizedCustomerActions, "canAnswerQuestion">;
  queryPending: boolean;
  queryError: boolean;
  canonicalAvailable: boolean;
};

const TERMINAL_LIFECYCLE_STATES: ReadonlySet<string> = new Set([
  ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
  ASSESSMENT_LIFECYCLE_STATES.FAILED,
  ASSESSMENT_LIFECYCLE_STATES.CANCELLED,
]);

const ACTIVE_LIFECYCLE_STATES: ReadonlySet<string> = new Set([
  ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
  ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN,
  ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_REQUIRED_INPUT,
]);

export function selectCanonicalInterviewPresentation(
  input: CanonicalInterviewPresentationInput,
): CanonicalInterviewPresentation {
  const answerHistory = input.interview.answerHistory;
  const activeQuestion = input.interview.activeQuestion;
  const hasContent = Boolean(activeQuestion) || answerHistory.length > 0;

  if (
    !input.canonicalAvailable ||
    input.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.PREPARING ||
    input.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.CREATED ||
    !hasContent
  ) {
    return {
      state: CANONICAL_INTERVIEW_PRESENTATION_STATES.hidden,
      activeQuestion: null,
      answerHistory,
      interviewOutcome: input.interview.outcome,
    };
  }

  const waitingForCustomer =
    input.interview.outcome ===
    ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer;
  const eligible =
    !input.queryPending &&
    !input.queryError &&
    !input.interview.stale &&
    !input.interview.revalidating &&
    ACTIVE_LIFECYCLE_STATES.has(input.lifecycleState ?? "") &&
    waitingForCustomer &&
    Boolean(activeQuestion) &&
    input.customerActions.canAnswerQuestion;

  return {
    state: eligible
      ? CANONICAL_INTERVIEW_PRESENTATION_STATES.interactiveEligible
      : CANONICAL_INTERVIEW_PRESENTATION_STATES.readOnly,
    activeQuestion,
    answerHistory,
    interviewOutcome: input.interview.outcome,
  };
}

export function isCanonicalInterviewTerminal(
  lifecycleState: (typeof ASSESSMENT_LIFECYCLE_STATES)[keyof typeof ASSESSMENT_LIFECYCLE_STATES] | null,
) {
  return lifecycleState !== null && TERMINAL_LIFECYCLE_STATES.has(lifecycleState);
}
