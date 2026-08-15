export type ConflictType =
  "evidence_contradiction" | "scope_mismatch" | "unverifiable";

export interface ConflictInputRequest {
  conflict_type: ConflictType;
  conflict_score: number;
  score_explanation: string;
  evidence_refs: string[];
  affected_claim_field?: string;
  conflicting_source_refs?: Record<string, unknown>;
  confidence?: string;
  contradiction_severity?: string;
  materiality_reason?: string;
  source_values?: Record<string, unknown>;
  evidence_context?: unknown[];
  explanation_basis?: Record<string, unknown>;
}

export interface ConflictDetectionCallbackRequest {
  ai_usage_flow_id: string;
  assessment_id: string;
  schema_version: string;
  provider_version: string;
  conflicts: ConflictInputRequest[];
  privacy_flags: Record<string, unknown>;
}

export interface ConflictDetectionCallbackDto {
  accepted: boolean;
  conflict_count: number;
  correlationId: string;
}
