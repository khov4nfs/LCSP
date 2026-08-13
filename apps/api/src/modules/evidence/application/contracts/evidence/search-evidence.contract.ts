import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "@lcsp/contracts/evidence";

export const SEARCH_EVIDENCE_CONFIDENCE = {
  low: "LOW",
  medium: "MEDIUM",
  high: "HIGH",
} as const;

export type SearchEvidenceConfidence =
  (typeof SEARCH_EVIDENCE_CONFIDENCE)[keyof typeof SEARCH_EVIDENCE_CONFIDENCE];

export type SearchEvidenceResponse = {
  status: AgenticToolStatus;
  tool_name: AgenticToolName;
  tool_version: string;
  config_hash: string;
  correlation_id: string;
  artifact_versions: { technical_evidence_report_id: string };
  provenance_ref: string;
  coverage_state: AgenticToolCoverageState;
  evidence_refs: string[];
  limitations: string[];
  result: {
    findings: Array<{
      finding_ref: string;
      kind: string;
      relative_location: string | null;
      provider: string | null;
      confidence: SearchEvidenceConfidence;
      evidence_refs: string[];
      limitation_refs: string[];
    }>;
    searched_scope: {
      artifact_version: string;
      finding_kinds: string[];
      providers: string[];
      path_prefixes: string[];
      min_confidence: SearchEvidenceConfidence | null;
      exhaustive: boolean;
    };
    next_cursor: string | null;
    truncated: boolean;
  };
};
