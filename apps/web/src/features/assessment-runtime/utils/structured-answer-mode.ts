import { HUMAN_RESOLUTION_CONTROL_TYPES } from "@lcsp/contracts/assessment-domain";
import { ANSWER_CONTROL_TYPES } from "../config/structured-answer";
import {
  STRUCTURED_ANSWER_MODES,
  type AnswerableRequest,
  type StructuredAnswerMode,
} from "../types/structured-answer.types";

/**
 * Business purpose:
 * Map a human resolution request's controlType and choices to the canonical UI answer mode.
 *
 * Business rules:
 * - `SINGLE_SELECT` with choices renders single-select radio/select; without choices falls back to free text.
 * - `BOOLEAN` renders explicit Yes/No boolean radio cards (defaulting to true/false when choices are omitted).
 * - `MULTI_SELECT` with choices renders multi-select checkboxes; without choices falls back to free text.
 * - Unknown or `FREE_TEXT` types render the free-text composer.
 *
 * Execution flow:
 * 1. Inspect `request.controlType` and `request.choices.length`.
 * 2. Return the matching `StructuredAnswerMode`.
 *
 * Failure cases:
 * - Empty choices on select modes safely fall back to `TEXT` instead of rendering an unanswerable control.
 *
 * Side effects:
 * - Pure mapping function.
 */
export function structuredAnswerMode(
  request: AnswerableRequest,
): StructuredAnswerMode {
  const hasChoices = request.choices.length > 0;
  switch (request.controlType) {
    case HUMAN_RESOLUTION_CONTROL_TYPES.SINGLE_SELECT:
      return hasChoices
        ? STRUCTURED_ANSWER_MODES.CHOICE
        : STRUCTURED_ANSWER_MODES.TEXT;
    case ANSWER_CONTROL_TYPES.BOOLEAN:
      return STRUCTURED_ANSWER_MODES.BOOLEAN;
    case ANSWER_CONTROL_TYPES.MULTI_SELECT:
      return hasChoices
        ? STRUCTURED_ANSWER_MODES.MULTI_CHOICE
        : STRUCTURED_ANSWER_MODES.TEXT;
    default:
      return STRUCTURED_ANSWER_MODES.TEXT;
  }
}
