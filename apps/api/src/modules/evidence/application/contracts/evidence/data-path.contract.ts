import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "@lcsp/contracts/evidence";
export const DATA_PATH_DIRECTIONS = {
  forward: "FORWARD",
  backward: "BACKWARD",
} as const;
export type DataPathDirection =
  (typeof DATA_PATH_DIRECTIONS)[keyof typeof DATA_PATH_DIRECTIONS];
export const DATA_CATEGORIES = {
  identifier: "IDENTIFIER",
  contact: "CONTACT",
  financial: "FINANCIAL",
  health: "HEALTH",
  legal: "LEGAL",
  content: "CONTENT",
  unknown: "UNKNOWN",
} as const;
export type DataCategory =
  (typeof DATA_CATEGORIES)[keyof typeof DATA_CATEGORIES];
export type DataPathResponse = {
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
    segments: Array<{
      segment_ref: string;
      role: string;
      categories: DataCategory[];
      from_ref: string;
      to_ref: string;
      relative_location: string | null;
      evidence_refs: string[];
    }>;
    terminal: { state: string; reason: string };
    truncated: boolean;
  };
};
