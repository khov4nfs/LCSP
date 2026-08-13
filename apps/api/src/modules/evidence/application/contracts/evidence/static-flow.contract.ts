import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "@lcsp/contracts/evidence";
export const STATIC_FLOW_DIRECTIONS = {
  forward: "FORWARD",
  backward: "BACKWARD",
} as const;
export type StaticFlowDirection =
  (typeof STATIC_FLOW_DIRECTIONS)[keyof typeof STATIC_FLOW_DIRECTIONS];
export const STATIC_FLOW_TERMINALS = {
  resolved: "RESOLVED",
  dynamicBoundary: "DYNAMIC_BOUNDARY",
  hopLimit: "HOP_LIMIT",
  notFound: "NOT_FOUND",
} as const;

export type StaticFlowTerminal =
  (typeof STATIC_FLOW_TERMINALS)[keyof typeof STATIC_FLOW_TERMINALS];
export type StaticFlowResponse = {
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
    segments: Array<{
      segment_ref: string;
      stage: string;
      from_ref: string;
      to_ref: string;
      relative_location: string | null;
      evidence_refs: string[];
    }>;
    terminal: {
      state: StaticFlowTerminal;
      reason: string;
      ref: string | null;
    };
    truncated: boolean;
  };
};
