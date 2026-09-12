export type ProgramEvidenceGraphMetric = number | null;

export interface ProgramEvidenceGraphRepositoryDto {
  repository_full_name: string | null;
  branch: string | null;
  ref: string | null;
  pinned_commit: string | null;
  status: string | null;
}

export interface ProgramEvidenceGraphNodeDto {
  id: string;
  kind: string;
  label: string;
  symbol: string | null;
  file: string | null;
  line: number | null;
}

export interface ProgramEvidenceGraphEdgeDto {
  id: string;
  source: string;
  target: string;
  relationship: string;
}

export interface ProgramEvidenceGraphClaimDto {
  id: string;
  meaning: string;
  symbol: string | null;
  file: string | null;
  line: number | null;
  evidence_refs: string[];
}

export interface ProgramEvidenceGraphSourceDto {
  file: string | null;
  symbol: string | null;
  start_line: number | null;
  end_line: number | null;
  evidence_reference: string | null;
}

export interface ProgramEvidenceGraphFindingDto {
  meaning: string;
  evidence_reference: string | null;
  source: ProgramEvidenceGraphSourceDto | null;
}

export interface ProgramEvidenceGraphDetailDto {
  repository: ProgramEvidenceGraphRepositoryDto;
  overview: {
    modules_analyzed: ProgramEvidenceGraphMetric;
    code_symbols_indexed: ProgramEvidenceGraphMetric;
    ai_model_invocations: ProgramEvidenceGraphMetric;
    evidence_mapped_scope: ProgramEvidenceGraphMetric;
  };
  paths: {
    nodes: ProgramEvidenceGraphNodeDto[];
    edges: ProgramEvidenceGraphEdgeDto[];
  };
  claims: ProgramEvidenceGraphClaimDto[];
  provenance: {
    evidence_report_id: string;
    snapshot_id: string;
    scan_job_id: string;
    generated_at: string;
    finding: ProgramEvidenceGraphFindingDto | null;
    source: ProgramEvidenceGraphSourceDto | null;
  };
}
