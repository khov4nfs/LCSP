import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "./agentic-tool.ts";

export const CLASSIFICATION_BASELINE_LABELS = {
  candidateA: "CLASSIFICATION_CANDIDATE_A",
} as const;

export type ClassificationBaselineLabel =
  (typeof CLASSIFICATION_BASELINE_LABELS)[keyof typeof CLASSIFICATION_BASELINE_LABELS];

export const CLASSIFICATION_BASELINE_PREREQUISITES = {
  verifiedProfileApproved: "VERIFIED_PROFILE_APPROVED",
  legalRuleMatchAccepted: "LEGAL_RULE_MATCH_ACCEPTED",
  validCitations: "VALID_CITATIONS",
  policyProfilePinned: "POLICY_PROFILE_PINNED",
} as const;

export type ClassificationBaselinePrerequisite =
  (typeof CLASSIFICATION_BASELINE_PREREQUISITES)[keyof typeof CLASSIFICATION_BASELINE_PREREQUISITES];

export const CLASSIFICATION_BASELINE_LIMITATION_CODES = {
  profileUnavailable: "CLASSIFICATION_PROFILE_UNAVAILABLE",
  ruleMatchUnavailable: "CLASSIFICATION_RULE_MATCH_UNAVAILABLE",
  policyUnavailable: "CLASSIFICATION_POLICY_UNAVAILABLE",
  guardrailBlocked: "CLASSIFICATION_RULE_MATCH_GUARDRAIL_BLOCKED",
  coverageLimited: "CLASSIFICATION_BASELINE_COVERAGE_LIMITED",
} as const;

export type ClassificationBaselineLimitationCode =
  (typeof CLASSIFICATION_BASELINE_LIMITATION_CODES)[keyof typeof CLASSIFICATION_BASELINE_LIMITATION_CODES];

export const GET_CLASSIFICATION_BASELINE_TOOL = {
  name: "get_classification_baseline",
  version: "1.0.0",
  configHash: "sha256:classification-baseline-v1",
  maxItems: 20,
} as const;

const STABLE_PROFILE_REF = "^profile_[A-Za-z0-9_-]{8,80}$";
const STABLE_RULE_MATCH_REF = "^rule-match:[A-Za-z0-9_-]{6,80}$";
const STABLE_POLICY_REF = "^policy_[A-Za-z0-9_-]{8,80}$";

export const GET_CLASSIFICATION_BASELINE_INPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verifiedProfileId", "ruleMatchRef", "policyProfileVersionId"],
  properties: {
    verifiedProfileId: { type: "string", pattern: STABLE_PROFILE_REF },
    ruleMatchRef: { type: "string", pattern: STABLE_RULE_MATCH_REF },
    policyProfileVersionId: { type: "string", pattern: STABLE_POLICY_REF },
  },
} as const;

export const GET_CLASSIFICATION_BASELINE_RESULT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "baselineRef",
    "eligibleLabels",
    "requiredPrerequisites",
    "unmetPrerequisites",
  ],
  properties: {
    baselineRef: {
      type: ["string", "null"],
      pattern: "^baseline:[A-Za-z0-9_-]{6,80}$",
    },
    eligibleLabels: {
      type: "array",
      maxItems: GET_CLASSIFICATION_BASELINE_TOOL.maxItems,
      items: { enum: Object.values(CLASSIFICATION_BASELINE_LABELS) },
    },
    requiredPrerequisites: {
      type: "array",
      maxItems: GET_CLASSIFICATION_BASELINE_TOOL.maxItems,
      items: { enum: Object.values(CLASSIFICATION_BASELINE_PREREQUISITES) },
    },
    unmetPrerequisites: {
      type: "array",
      maxItems: GET_CLASSIFICATION_BASELINE_TOOL.maxItems,
      items: { enum: Object.values(CLASSIFICATION_BASELINE_PREREQUISITES) },
    },
  },
} as const;

export type GetClassificationBaselineInput = {
  verifiedProfileId: string;
  ruleMatchRef: string;
  policyProfileVersionId: string;
};

export type GetClassificationBaselineResponse = {
  status: AgenticToolStatus;
  toolName: AgenticToolName;
  toolVersion: string;
  configHash: string;
  correlationId: string;
  artifactVersions: {
    profileId: string;
    ruleMatchRef: string;
    policyProfileVersionId: string;
  };
  provenanceRef: string;
  coverageState: AgenticToolCoverageState;
  evidenceRefs: string[];
  limitations: Array<{
    code: ClassificationBaselineLimitationCode;
    affectedScopeRef: string | null;
    reason: string;
    retryable: boolean;
  }>;
  result: {
    baselineRef: string | null;
    eligibleLabels: ClassificationBaselineLabel[];
    requiredPrerequisites: ClassificationBaselinePrerequisite[];
    unmetPrerequisites: ClassificationBaselinePrerequisite[];
  };
};
