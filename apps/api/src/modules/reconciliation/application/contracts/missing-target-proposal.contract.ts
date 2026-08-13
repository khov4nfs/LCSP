import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "@lcsp/contracts/evidence";

export const TARGET_CANDIDATE_KINDS = {
  providerUsage: "PROVIDER_USAGE",
  dataFlow: "DATA_FLOW",
  decisionFlow: "DECISION_FLOW",
  humanReview: "HUMAN_REVIEW",
  deployment: "DEPLOYMENT",
} as const;

export type TargetCandidateKind =
  (typeof TARGET_CANDIDATE_KINDS)[keyof typeof TARGET_CANDIDATE_KINDS];

export const TARGET_CANDIDATE_LIMITATION_CODES = {
  submittedTargetIdsUnavailable: "SUBMITTED_TARGET_IDS_UNAVAILABLE",
  unsupportedCandidateKind: "UNSUPPORTED_CANDIDATE_KIND",
} as const;

export type MissingTargetCandidate = {
  candidate_ref: string;
  kind: TargetCandidateKind;
  target_ref: string;
  attributes: Record<string, string>;
  score: number;
  evidence_refs: string[];
  exclusion_reason?: string;
};

export type MissingTargetProposalResponse = {
  status: AgenticToolStatus;
  tool_name: AgenticToolName;
  tool_version: string;
  config_hash: string;
  correlationId: string;
  artifact_versions: {
    wizard_profile_id: string;
    technical_evidence_report_id: string;
  };
  provenance_ref: string;
  coverage_state: AgenticToolCoverageState;
  evidence_refs: string[];
  limitations: string[];
  result: {
    algorithm_version: string;
    candidates: MissingTargetCandidate[];
    truncated: boolean;
  };
};
