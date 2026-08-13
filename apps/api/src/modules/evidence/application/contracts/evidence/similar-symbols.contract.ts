import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "@lcsp/contracts/evidence";
export const SYMBOL_SIMILARITY_DIMENSIONS = {
  callGraph: "CALL_GRAPH",
  imports: "IMPORTS",
  decorators: "DECORATORS",
  categories: "CATEGORIES",
  dataFlow: "DATA_FLOW",
} as const;
export type SymbolSimilarityDimension =
  (typeof SYMBOL_SIMILARITY_DIMENSIONS)[keyof typeof SYMBOL_SIMILARITY_DIMENSIONS];
export type SimilarSymbolsResponse = {
  status: AgenticToolStatus;
  tool_name: AgenticToolName;
  tool_version: string;
  config_hash: string;
  correlationId: string;
  artifact_versions: { technical_evidence_report_id: string };
  provenance_ref: string;
  coverage_state: AgenticToolCoverageState;
  evidence_refs: string[];
  limitations: string[];
  result: {
    algorithm_version: string;
    candidates: Array<{
      symbol_ref: string;
      score: number;
      matched_dimensions: SymbolSimilarityDimension[];
      relative_location: string | null;
      evidence_refs: string[];
    }>;
    truncated: boolean;
  };
};
