import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "./agentic-tool.ts";

export const LEGAL_RULE_MATCH_APPLICABILITY = {
  applicable: "APPLICABLE",
  conditional: "CONDITIONAL",
  unavailable: "UNAVAILABLE",
} as const;

export type LegalRuleMatchApplicability =
  (typeof LEGAL_RULE_MATCH_APPLICABILITY)[keyof typeof LEGAL_RULE_MATCH_APPLICABILITY];

export const LEGAL_RULE_MATCH_LIMITATION_CODES = {
  noAcceptedMatch: "NO_ACCEPTED_RULE_MATCH",
  ruleUnavailable: "RULE_UNAVAILABLE",
  citationMismatch: "CITATION_MISMATCH",
  guardrailBlocked: "RULE_MATCH_GUARDRAIL_BLOCKED",
  coverageLimited: "RULE_MATCH_COVERAGE_LIMITED",
  projectionUnavailable: "RULE_MATCH_PROJECTION_UNAVAILABLE",
} as const;

export type LegalRuleMatchLimitationCode =
  (typeof LEGAL_RULE_MATCH_LIMITATION_CODES)[keyof typeof LEGAL_RULE_MATCH_LIMITATION_CODES];

export const GET_LEGAL_RULE_MATCH_TOOL = {
  name: "get_legal_rule_match",
  version: "1.0.0",
  configHash: "sha256:rule-match-v1",
  maxCitationRefs: 15,
  maxFacts: 30,
} as const;

const STABLE_PROFILE_REF = "^profile_[A-Za-z0-9_-]{8,80}$";
const STABLE_RULE_REF = "^rule_[A-Za-z0-9_-]{6,80}$";
const STABLE_CITATION_REF = "^citation:chunk_[A-Za-z0-9_-]{6,80}$";

export const GET_LEGAL_RULE_MATCH_INPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verifiedProfileId", "ruleId", "citationRefs"],
  properties: {
    verifiedProfileId: { type: "string", pattern: STABLE_PROFILE_REF },
    ruleId: { type: "string", pattern: STABLE_RULE_REF },
    citationRefs: {
      type: "array",
      minItems: 1,
      maxItems: GET_LEGAL_RULE_MATCH_TOOL.maxCitationRefs,
      uniqueItems: true,
      items: { type: "string", pattern: STABLE_CITATION_REF },
    },
  },
} as const;

export const GET_LEGAL_RULE_MATCH_RESULT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "legalRuleMatchId",
    "ruleId",
    "applicability",
    "requiredFacts",
    "knownFacts",
    "missingFacts",
    "unknownFacts",
    "allowedCitationRefs",
  ],
  properties: {
    legalRuleMatchId: { type: ["string", "null"], maxLength: 128 },
    ruleId: { type: "string", pattern: STABLE_RULE_REF },
    applicability: { enum: Object.values(LEGAL_RULE_MATCH_APPLICABILITY) },
    requiredFacts: {
      type: "array",
      maxItems: GET_LEGAL_RULE_MATCH_TOOL.maxFacts,
      items: { type: "string", maxLength: 128 },
    },
    knownFacts: {
      type: "array",
      maxItems: GET_LEGAL_RULE_MATCH_TOOL.maxFacts,
      items: { type: "string", maxLength: 128 },
    },
    missingFacts: {
      type: "array",
      maxItems: GET_LEGAL_RULE_MATCH_TOOL.maxFacts,
      items: { type: "string", maxLength: 128 },
    },
    unknownFacts: {
      type: "array",
      maxItems: GET_LEGAL_RULE_MATCH_TOOL.maxFacts,
      items: { type: "string", maxLength: 128 },
    },
    allowedCitationRefs: {
      type: "array",
      maxItems: GET_LEGAL_RULE_MATCH_TOOL.maxCitationRefs,
      items: { type: "string", pattern: STABLE_CITATION_REF },
    },
  },
} as const;

export type GetLegalRuleMatchInput = {
  verifiedProfileId: string;
  ruleId: string;
  citationRefs: string[];
};

export type GetLegalRuleMatchResponse = {
  status: AgenticToolStatus;
  toolName: AgenticToolName;
  toolVersion: string;
  configHash: string;
  correlationId: string;
  artifactVersions: {
    verifiedProfileId: string;
    ruleId: string;
    legalRuleMatchId: string | null;
    corpusVersionId: string | null;
    legalRuleCatalogVersionId: string | null;
  };
  provenanceRef: string;
  coverageState: AgenticToolCoverageState;
  evidenceRefs: string[];
  limitations: Array<{
    code: LegalRuleMatchLimitationCode;
    affectedScopeRef: string | null;
    reason: string;
    retryable: boolean;
  }>;
  result: {
    legalRuleMatchId: string | null;
    ruleId: string;
    applicability: LegalRuleMatchApplicability;
    requiredFacts: string[];
    knownFacts: string[];
    missingFacts: string[];
    unknownFacts: string[];
    allowedCitationRefs: string[];
  };
};
