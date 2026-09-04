import type { AssessmentStatusCode } from "@lcsp/contracts/assessment";

export interface AssessmentSummary {
  assessment_id: string;
  name: string;
  status: AssessmentStatusCode;
  created_at: string;
  updated_at: string;
}

export interface AssessmentListDto {
  assessments: AssessmentSummary[];
  total: number;
  page: number;
  page_size: number;
  correlationId: string;
}
