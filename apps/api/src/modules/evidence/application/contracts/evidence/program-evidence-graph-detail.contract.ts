export type ProgramEvidenceGraphMetric = number | null;

export interface ProgramEvidenceGraphOverviewDto {
  modules_analyzed: ProgramEvidenceGraphMetric;
  code_symbols_indexed: ProgramEvidenceGraphMetric;
  ai_model_invocations: ProgramEvidenceGraphMetric;
  evidence_mapped_scope: ProgramEvidenceGraphMetric;
}

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
  ai_usage_role?: string | null;
  evidence_state?: string | null;
  resolution_state?: string | null;
}

export interface ProgramEvidenceGraphEdgeDto {
  id: string;
  source: string;
  target: string;
  relationship: string;
  evidence_state?: string | null;
  resolution_state?: string | null;
}

export interface ProgramEvidenceGraphUsageFlowGroupDto {
  key: string;
  label: string;
  source_node_id: string | null;
  source_label: string | null;
  provider_label: string | null;
  gateway_label: string | null;
  usage_flow_count: number;
  rendered_usage_flow_count: number;
  omitted_usage_flow_count: number;
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
  overview: ProgramEvidenceGraphOverviewDto;
  paths: {
    nodes: ProgramEvidenceGraphNodeDto[];
    edges: ProgramEvidenceGraphEdgeDto[];
    usage_flow_count: number;
    rendered_usage_flow_count: number;
    omitted_usage_flow_count: number;
    usage_group_count: number;
    rendered_usage_group_count: number;
    omitted_usage_group_count: number;
    usage_flow_groups: ProgramEvidenceGraphUsageFlowGroupDto[];
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
