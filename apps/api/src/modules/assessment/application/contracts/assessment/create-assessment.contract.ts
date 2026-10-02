export { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import { type AssessmentStatusCode } from "@lcsp/contracts/assessment";

export interface CreateAssessmentDto {
  assessment_id: string;
  name: string;
  status: AssessmentStatusCode;
  owner_id: string;
  created_at: string;
  correlationId: string;
}
