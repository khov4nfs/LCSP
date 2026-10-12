import { HUMAN_RESOLUTION_CONTROL_TYPES } from "@lcsp/contracts/assessment-domain";
import { ANSWER_CONTROL_TYPES } from "../config/structured-answer";
import {
  STRUCTURED_ANSWER_MODES,
  type AnswerableRequest,
  type StructuredAnswerMode,
} from "../types/structured-answer.types";

/**
 * Chooses the control from the request itself. A choice control without choices cannot be
 * answered, so it falls back to free text; an unknown control type is free text too.
 */
export function structuredAnswerMode(
  request: AnswerableRequest,
): StructuredAnswerMode {
  const hasChoices = request.choices.length > 0;
  switch (request.controlType) {
    case HUMAN_RESOLUTION_CONTROL_TYPES.SINGLE_SELECT:
    case ANSWER_CONTROL_TYPES.BOOLEAN:
      return hasChoices
        ? STRUCTURED_ANSWER_MODES.CHOICE
        : STRUCTURED_ANSWER_MODES.TEXT;
    case ANSWER_CONTROL_TYPES.MULTI_SELECT:
      return hasChoices
        ? STRUCTURED_ANSWER_MODES.MULTI_CHOICE
        : STRUCTURED_ANSWER_MODES.TEXT;
    default:
      return STRUCTURED_ANSWER_MODES.TEXT;
  }
}
