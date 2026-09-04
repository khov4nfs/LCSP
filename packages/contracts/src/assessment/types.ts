import type { ASSESSMENT_ERROR_CODES } from "./codes.ts";
import type { ASSESSMENT_STATUS_CODES } from "./statuses.ts";

export type AssessmentErrorCode =
  (typeof ASSESSMENT_ERROR_CODES)[keyof typeof ASSESSMENT_ERROR_CODES];

export type AssessmentStatusCode =
  (typeof ASSESSMENT_STATUS_CODES)[keyof typeof ASSESSMENT_STATUS_CODES];
