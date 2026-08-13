import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "@lcsp/contracts/evidence";

export const HUMAN_REVIEW_STATES = {
  present: "PRESENT",
  absent: "ABSENT",
  unknown: "UNKNOWN",
} as const;
export type HumanReviewState =
  (typeof HUMAN_REVIEW_STATES)[keyof typeof HUMAN_REVIEW_STATES];
export const HUMAN_REVIEW_KINDS = {
  queue: "QUEUE",
  assignment: "ASSIGNMENT",
  approval: "APPROVAL",
  stateGate: "STATE_GATE",
  escalation: "ESCALATION",
} as const;
export type HumanReviewKind =
  (typeof HUMAN_REVIEW_KINDS)[keyof typeof HUMAN_REVIEW_KINDS];
export type HumanReviewPathResponse = {
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
    review_state: HumanReviewState;
    segments: Array<{
      segment_ref: string;
      review_kind: HumanReviewKind;
      relative_location: string | null;
      evidence_refs: string[];
    }>;
    terminal: { state: string; reason: string };
    truncated: boolean;
  };
};
