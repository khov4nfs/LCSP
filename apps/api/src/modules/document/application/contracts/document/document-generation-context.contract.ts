export interface DocumentGenerationContextDto {
  document_request: {
    id: string;
    assessment_id: string;
    organization_id: string;
    classification_result_id: string;
    document_type: string;
  };
  assessment: {
    id: string;
    name: string;
    description: string | null;
  };
  classification_result: {
    id: string;
    verified_profile_id: string;
    legal_rule_match_id: string;
    classification_data: unknown;
    guardrail_status: string;
  };
  verified_profile: {
    id: string;
    version: number;
    ai_usage_flow_id: string;
    wizard_profile_id: string | null;
    technical_evidence_report_id: string | null;
    profile_data: unknown;
  };
  ai_usage_flow: {
    id: string;
    technical_profile_id: string;
    claims: unknown;
    unknown_usages: unknown;
  };
  technical_profile: {
    id: string;
    evidence_report_id: string;
    profile_data: unknown;
  };
  technical_evidence_report: {
    id: string;
    snapshot_id: string;
    schema_version: string;
    evidence_payload: unknown;
  };
  repository_snapshot: {
    id: string;
    commit_sha: string;
  };
  wizard_profile: {
    id: string;
    version: number;
    answers: unknown;
  } | null;
  legal_rule_match: {
    id: string;
    corpus_version_id: string;
    legal_rule_catalog_version_id: string;
    matches: unknown;
    citation_allowlist: unknown;
    overall_coverage_status: string;
  };
  conflicts: Array<{
    id: string;
    conflict_type: string;
    conflict_score: number;
    evidence_refs: unknown;
    status: string;
    resolved_at: string | null;
  }>;
  matrix_ref: string;
}
