import type { AssessmentHumanRequestView } from "@lcsp/contracts/assessment-domain";

/**
 * How a human request is answered: free text, single-select, multi-select, or boolean.
 */
export const STRUCTURED_ANSWER_MODES = {
  TEXT: "TEXT",
  CHOICE: "CHOICE",
  MULTI_CHOICE: "MULTI_CHOICE",
  BOOLEAN: "BOOLEAN",
} as const;
export type StructuredAnswerMode =
  (typeof STRUCTURED_ANSWER_MODES)[keyof typeof STRUCTURED_ANSWER_MODES];

export type StructuredAnswerChoice = {
  value: string;
  label: string;
  exclusive?: boolean;
};

/** The customer's answer: a fact, or an honest "I don't know". Never a verdict. */
export type StructuredAnswer =
  | { doesNotKnow: true }
  | { doesNotKnow: false; answer: string };

export type StructuredAnswerControlProps = {
  mode: StructuredAnswerMode;
  choices: readonly StructuredAnswerChoice[];
  /** Stable DOM id base so the control can be labelled by the question. */
  idBase: string;
  disabled?: boolean;
  pending?: boolean;
  failed?: boolean;
  staleConflict?: boolean;
  onSubmit: (answer: StructuredAnswer) => void;
};

export type AnswerableRequest = Pick<
  AssessmentHumanRequestView,
  "controlType" | "choices"
>;
