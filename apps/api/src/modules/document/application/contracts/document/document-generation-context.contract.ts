export interface DocumentGenerationContextDto {
  document_request: {
    id: string;
    assessment_id: string;
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
    technical_evidence_report_id: string;
    classification_data: unknown;
    guardrail_status: string;
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
  matrix_ref: string;
}
