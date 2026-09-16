export type ClassificationStatusPageProps = {
  assessmentId: string;
};

import type {
  ClassificationAssessmentOutcome,
  ClassificationEvidenceQuality,
  ClassificationExecutionState,
} from "@/lib/api/classification-client";

export type ClassificationResultPanelProps = {
  executionState: ClassificationExecutionState;
  assessmentOutcome: ClassificationAssessmentOutcome | null;
  evidenceQuality: ClassificationEvidenceQuality | null;
};
