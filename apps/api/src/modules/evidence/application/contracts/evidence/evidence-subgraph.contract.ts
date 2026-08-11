import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "@lcsp/contracts/evidence";

export const EVIDENCE_SUBGRAPH_DIRECTIONS = {
  inbound: "INBOUND",
  outbound: "OUTBOUND",
  both: "BOTH",
} as const;

export type EvidenceSubgraphDirection =
  (typeof EVIDENCE_SUBGRAPH_DIRECTIONS)[keyof typeof EVIDENCE_SUBGRAPH_DIRECTIONS];

export type EvidenceSubgraphResponse = {
  status: AgenticToolStatus;
  tool_name: AgenticToolName;
  tool_version: string;
  config_hash: string;
  correlation_id: string;
  artifact_versions: {
    technical_evidence_report_id: string;
    evidence_graph_id: string;
  };
  provenance_ref: string;
  coverage_state: AgenticToolCoverageState;
  evidence_refs: string[];
  limitations: string[];
  result: {
    nodes: Array<{
      node_ref: string;
      type: string;
      label: string;
      relative_location: string | null;
      evidence_refs: string[];
    }>;
    edges: Array<{
      edge_ref: string;
      type: string;
      from_ref: string;
      to_ref: string;
      evidence_refs: string[];
    }>;
    traversal: { visited_depth: number };
    truncated: boolean;
  };
};
