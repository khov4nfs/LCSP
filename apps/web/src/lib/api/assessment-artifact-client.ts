import type {
  AssessmentArtifactAvailabilityProjection,
  BusinessContextArtifact,
  InvestigationNotesArtifact,
} from "@lcsp/contracts/evidence";

import { apiJson } from "./api-request.ts";

export function getAssessmentArtifactAvailability(
  assessmentId: string,
): Promise<AssessmentArtifactAvailabilityProjection | null> {
  return apiJson<AssessmentArtifactAvailabilityProjection>(
    `/api/assessments/${encodeURIComponent(assessmentId)}/artifacts`,
    { cache: "no-store" },
  );
}

export function getBusinessContextArtifact(
  assessmentId: string,
): Promise<BusinessContextArtifact | null> {
  return apiJson<BusinessContextArtifact>(
    `/api/assessments/${encodeURIComponent(assessmentId)}/artifacts/business-context`,
    { cache: "no-store" },
  );
}

export function getInvestigationNotesArtifact(
  assessmentId: string,
): Promise<InvestigationNotesArtifact | null> {
  return apiJson<InvestigationNotesArtifact>(
    `/api/assessments/${encodeURIComponent(assessmentId)}/artifacts/investigation-notes`,
    { cache: "no-store" },
  );
}
