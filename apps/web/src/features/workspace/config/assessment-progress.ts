import type { AssessmentStatus } from "../types/workspace.types";

const progressByStatus: Record<AssessmentStatus, number> = {
  WIZARD_IN_PROGRESS: 20,
  WIZARD_SUBMITTED: 35,
  EVIDENCE_REQUIRED: 45,
  SCAN_IN_PROGRESS: 60,
  CLASSIFICATION_LOCKED: 75,
  READY_FOR_REVIEW: 100,
  AI_NOT_DETECTED: 100,
};

export function getAssessmentProgress(status: AssessmentStatus): number {
  return progressByStatus[status];
}
