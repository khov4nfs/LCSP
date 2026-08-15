import type { CONFLICT_RECORD_STATUSES } from "@lcsp/contracts/scan";

export type ConflictStatus =
  (typeof CONFLICT_RECORD_STATUSES)[keyof typeof CONFLICT_RECORD_STATUSES];

export interface ConflictSummary {
  conflict_id: string;
  conflict_type: string;
  conflict_score: number;
  score_explanation: string;
  explanation_basis: ConflictExplanationBasis;
  status: ConflictStatus;
  evidence_refs: string[];
  created_at: string;
}

export interface ConflictExplanationBasis {
  affected_field: string;
  confidence: string;
  materiality_reason: string;
  score_priority_explanation: string;
  source_values: ConflictSourceValues;
  source_refs: Record<string, string>;
  evidence_context: ConflictEvidenceContext[];
}

export interface ConflictSourceValues {
  manager_answer: string | null;
  technical_evidence: string | null;
}

export interface ConflictEvidenceContext {
  evidence_ref: string;
  redacted_context: string;
  coverage_limitations: string;
}

export interface ConflictListDto {
  conflicts: ConflictSummary[];
  total: number;
  page: number;
  page_size: number;
  correlationId: string;
}
