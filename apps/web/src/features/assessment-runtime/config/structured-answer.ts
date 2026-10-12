/** Choices shown as buttons up to this many; more become a select. */
export const CHOICE_BUTTON_LIMIT = 5;

/** Identifiers a human request may carry as its control type. */
export const ANSWER_CONTROL_TYPES = {
  BOOLEAN: "BOOLEAN",
  MULTI_SELECT: "MULTI_SELECT",
} as const;
