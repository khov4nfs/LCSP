import type {
  LegalMatchType,
  LegalRuleMatchGuardrailStatus,
  OverallCoverageStatus,
} from "@lcsp/contracts/scan";

export interface LegalRuleMatchItemDto {
  match_id: string;
  rule_id: string;
  legal_rule_catalog_version_id: string;
  article_ref: string;
  clause_ref: string;
  match_type: LegalMatchType;
  citation_chunk_ids: string[];
  context_roles?: LegalMatchType[];
  confidence: number;
  coverage_status: OverallCoverageStatus;
  usage_claim_ref: string;
  legal_status?: string;
}

export interface LegalRuleEvaluationDiagnosticDto {
  rule_id: string;
  status: string;
  rationale: string[];
  matched_required_facts: string[];
  blocking_facts: string[];
}

export interface LegalRuleMatchDiagnosticsDto {
  no_match_reason?: string | null;
  rule_count?: number;
  candidate_rule_count?: number;
  chunk_count?: number;
  deterministic_match_count?: number;
  matched_without_citation_count?: number;
  match_count?: number;
  profile_fact_fields?: string[];
  profile_evidence_fields?: string[];
  evaluations?: LegalRuleEvaluationDiagnosticDto[];
  evaluations_truncated?: boolean;
}

export interface AcceptLegalRuleMatchDto {
  verified_profile_id: string;
  assessment_id: string;
  corpus_version_id: string;
  legal_rule_catalog_version_id: string;
  schema_version: string;
  matches: LegalRuleMatchItemDto[];
  citation_allowlist: string[];
  overall_coverage_status: OverallCoverageStatus;
  diagnostics?: LegalRuleMatchDiagnosticsDto;
}

export interface LegalRuleMatchCallbackResponseDto {
  accepted: boolean;
  legal_rule_match_id: string;
  guardrail_status: LegalRuleMatchGuardrailStatus;
  correlationId?: string;
}
