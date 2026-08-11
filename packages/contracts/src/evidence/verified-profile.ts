import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "./agentic-tool.ts";

export const VERIFIED_PROFILE_REQUIRED_FOR = {
  legalMatching: "LEGAL_MATCHING",
  classification: "CLASSIFICATION",
  gapAnalysis: "GAP_ANALYSIS",
} as const;

export type VerifiedProfileRequiredFor =
  (typeof VERIFIED_PROFILE_REQUIRED_FOR)[keyof typeof VERIFIED_PROFILE_REQUIRED_FOR];

export const GET_VERIFIED_PROFILE_TOOL = {
  name: "get_verified_profile",
  version: "1.0.0",
  configHash: "sha256:verified-profile-v1",
} as const;

export const VERIFIED_PROFILE_REVIEW_STATES = {
  present: "PRESENT",
  unknown: "UNKNOWN",
} as const;

export type VerifiedProfileReviewState =
  (typeof VERIFIED_PROFILE_REVIEW_STATES)[keyof typeof VERIFIED_PROFILE_REVIEW_STATES];

export type GetVerifiedProfileInput = {
  verifiedProfileRef: string;
  expectedVersion: string;
  requiredFor: VerifiedProfileRequiredFor;
};

export type VerifiedProfileLegalSafeFacts = {
  aiUsageTypes: string[];
  providers: string[];
  reviewState: VerifiedProfileReviewState;
  deploymentCategories: string[];
};

export type GetVerifiedProfileResponse = {
  status: AgenticToolStatus;
  tool_name: AgenticToolName;
  tool_version: string;
  config_hash: string;
  correlation_id: string;
  artifact_versions: { verified_profile_id: string; version: string };
  provenance_ref: string;
  coverage_state: AgenticToolCoverageState;
  evidence_refs: string[];
  limitations: string[];
  result: {
    profile_ref: string;
    version: string;
    status: string;
    legal_safe_facts: VerifiedProfileLegalSafeFacts;
    fact_evidence_refs: string[];
    gates_passed_at: string | null;
    blocking_reason: null;
  };
};
