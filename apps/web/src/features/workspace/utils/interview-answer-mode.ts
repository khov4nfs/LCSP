import {
  ASSESSMENT_INTERVIEW_CONTROLS,
  type AssessmentInterviewQuestion,
} from "@lcsp/contracts/evidence";

export const INTERVIEW_ANSWER_MODES = {
  freeText: "FREE_TEXT",
  structuredSelection: "STRUCTURED_SELECTION",
  structuredSelectionWithText: "STRUCTURED_SELECTION_WITH_TEXT",
  confirmAdjust: "CONFIRM_ADJUST",
  adjustmentText: "ADJUSTMENT_TEXT",
  disabled: "DISABLED",
} as const;
export type InterviewAnswerMode =
  (typeof INTERVIEW_ANSWER_MODES)[keyof typeof INTERVIEW_ANSWER_MODES];

export const INTERVIEW_COMPOSER_MODES = {
  freeText: "FREE_TEXT",
  requiredSelectionText: "REQUIRED_SELECTION_TEXT",
  adjustmentText: "ADJUSTMENT_TEXT",
  disabled: "DISABLED",
} as const;
export type InterviewComposerMode =
  (typeof INTERVIEW_COMPOSER_MODES)[keyof typeof INTERVIEW_COMPOSER_MODES];

export function isStructuredSelectionControl(
  control: AssessmentInterviewQuestion["control"],
) {
  return (
    control === ASSESSMENT_INTERVIEW_CONTROLS.boolean ||
    control === ASSESSMENT_INTERVIEW_CONTROLS.singleSelect ||
    control === ASSESSMENT_INTERVIEW_CONTROLS.multiSelect
  );
}

export function deriveInterviewAnswerMode(input: {
  question: AssessmentInterviewQuestion | null;
  selectedChoiceRequiresFreeText: boolean;
  isAdjusting: boolean;
  pending: boolean;
  submitted: boolean;
  stale: boolean;
  revalidating: boolean;
  canAnswer: boolean;
}): InterviewAnswerMode {
  if (
    !input.question ||
    !input.canAnswer ||
    input.pending ||
    input.submitted ||
    input.stale ||
    input.revalidating
  ) return INTERVIEW_ANSWER_MODES.disabled;
  if (input.question.control === ASSESSMENT_INTERVIEW_CONTROLS.freeText)
    return INTERVIEW_ANSWER_MODES.freeText;
  if (input.question.control === ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust)
    return input.isAdjusting
      ? INTERVIEW_ANSWER_MODES.adjustmentText
      : INTERVIEW_ANSWER_MODES.confirmAdjust;
  if (isStructuredSelectionControl(input.question.control))
    return input.selectedChoiceRequiresFreeText
      ? INTERVIEW_ANSWER_MODES.structuredSelectionWithText
      : INTERVIEW_ANSWER_MODES.structuredSelection;
  return INTERVIEW_ANSWER_MODES.disabled;
}

export function composerModeForAnswerMode(
  mode: InterviewAnswerMode,
): InterviewComposerMode {
  switch (mode) {
    case INTERVIEW_ANSWER_MODES.freeText:
      return INTERVIEW_COMPOSER_MODES.freeText;
    case INTERVIEW_ANSWER_MODES.structuredSelectionWithText:
      return INTERVIEW_COMPOSER_MODES.requiredSelectionText;
    case INTERVIEW_ANSWER_MODES.adjustmentText:
      return INTERVIEW_COMPOSER_MODES.adjustmentText;
    default:
      return INTERVIEW_COMPOSER_MODES.disabled;
  }
}
