import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "@lcsp/contracts/evidence";
export const DECISION_ACTION_CATEGORIES = {
  score: "SCORE",
  rank: "RANK",
  recommend: "RECOMMEND",
  approve: "APPROVE",
  reject: "REJECT",
  statusChange: "STATUS_CHANGE",
} as const;
export type DecisionActionCategory =
  (typeof DECISION_ACTION_CATEGORIES)[keyof typeof DECISION_ACTION_CATEGORIES];
export type DecisionPathResponse = {
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
      action_category: DecisionActionCategory;
      confidence: string | null;
      from_ref: string;
      to_ref: string;
      relative_location: string | null;
      evidence_refs: string[];
    }>;
    terminal: { state: string; reason: string };
    truncated: boolean;
  };
};
