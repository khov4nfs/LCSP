export { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_ERROR_CODES,
  type AssessmentStatusCode,
} from "@lcsp/contracts/assessment";

export type AssessmentErrorCode =
  (typeof ASSESSMENT_ERROR_CODES)[keyof typeof ASSESSMENT_ERROR_CODES];

export interface CreateAssessmentPayload {
  name?: string;
  description?: string;
}

export interface CreateAssessmentDto {
  assessment_id: string;
  name: string;
  status: AssessmentStatusCode;
  owner_id: string;
  organization_id: string;
  created_at: string;
  correlationId: string;
}
