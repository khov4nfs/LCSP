import type { ASSESSMENT_ERROR_CODES } from "./codes.ts";

export type AssessmentErrorCode =
  (typeof ASSESSMENT_ERROR_CODES)[keyof typeof ASSESSMENT_ERROR_CODES];
