import type {
  AssessmentMissingEvidenceCode,
  AssessmentNextActionKey,
  ReadinessMode,
} from "@lcsp/contracts/assessment";

export interface AssessmentReadinessStatusDto {
  classification_locked: boolean;
  missing_evidence: Array<{
    type: AssessmentMissingEvidenceCode;
    label: string;
    description: string;
  }>;
  unresolved_unknown_items: Array<{
    questionId: string;
    label: string;
    answerState: string;
  }>;
  readiness_mode: ReadinessMode | null;
  completed_steps: string[];
  next_action: AssessmentNextActionKey;
  updated_at: string;
  repository_connection: {
    connection_id: string;
    provider: string;
    repository_id: string;
    repository_full_name: string;
    default_branch: string;
    status: string;
  } | null;
}
