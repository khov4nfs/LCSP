export interface MissingEvidenceItem {
  type: string;
  label: string;
  description: string;
}

export interface UnresolvedUnknownItem {
  questionId: string;
  label: string;
  answerState: "EXPLICIT_UNKNOWN";
}

export interface ReadinessResponse {
  assessment_id: string;
  wizard_status: string;
  readiness_mode: string | null;
  classification_locked: boolean;
  lock_reason: string | null;
  missing_evidence: MissingEvidenceItem[];
  unresolved_unknown_items: UnresolvedUnknownItem[];
  completed_steps: string[];
  next_action: string;
  updated_at: string;
  correlationId: string;
}
