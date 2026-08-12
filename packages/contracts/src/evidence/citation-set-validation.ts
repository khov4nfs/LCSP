import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "./agentic-tool.ts";

export const CITATION_SET_VALIDITY = {
  valid: "VALID",
  absent: "ABSENT",
  repealed: "REPEALED",
  outOfAllowlist: "OUT_OF_ALLOWLIST",
  versionMismatch: "VERSION_MISMATCH",
} as const;

export type CitationSetValidity =
  (typeof CITATION_SET_VALIDITY)[keyof typeof CITATION_SET_VALIDITY];

export const VALIDATE_CITATION_SET_TOOL = {
  name: "validate_citation_set",
  version: "1.0.0",
  configHash: "sha256:citation-validator-v1",
  maxCitationRefs: 20,
} as const;

const STABLE_CORPUS_REF = "^corpus_[A-Za-z0-9_-]{8,80}$";
const STABLE_MATCH_REF = "^legal_rule_match_[A-Za-z0-9_-]{6,80}$";
const STABLE_CITATION_REF = "^citation:chunk_[A-Za-z0-9_-]{6,80}$";

export const VALIDATE_CITATION_SET_INPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["corpusVersionId", "legalRuleMatchId", "citationRefs"],
  properties: {
    corpusVersionId: { type: "string", pattern: STABLE_CORPUS_REF },
    legalRuleMatchId: { type: "string", pattern: STABLE_MATCH_REF },
    citationRefs: {
      type: "array",
      minItems: 1,
      maxItems: VALIDATE_CITATION_SET_TOOL.maxCitationRefs,
      uniqueItems: true,
      items: { type: "string", pattern: STABLE_CITATION_REF },
    },
  },
} as const;

export const VALIDATE_CITATION_SET_RESULT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["valid", "items", "validatedAtVersion"],
  properties: {
    valid: { type: "boolean" },
    items: {
      type: "array",
      maxItems: VALIDATE_CITATION_SET_TOOL.maxCitationRefs,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["citationRef", "validity", "reasonCode"],
        properties: {
          citationRef: { type: "string", pattern: STABLE_CITATION_REF },
          validity: { enum: Object.values(CITATION_SET_VALIDITY) },
          reasonCode: { type: ["string", "null"], maxLength: 64 },
        },
      },
    },
    validatedAtVersion: { type: "string", pattern: STABLE_CORPUS_REF },
  },
} as const;

export type ValidateCitationSetInput = {
  corpusVersionId: string;
  legalRuleMatchId: string;
  citationRefs: string[];
};

export type ValidateCitationSetResponse = {
  status: AgenticToolStatus;
  toolName: AgenticToolName;
  toolVersion: string;
  configHash: string;
  correlationId: string;
  artifactVersions: { corpusVersionId: string; legalRuleMatchId: string };
  provenanceRef: string;
  coverageState: AgenticToolCoverageState;
  evidenceRefs: string[];
  limitations: Array<{
    code: string;
    affectedScopeRef: string | null;
    reason: string;
    retryable: boolean;
  }>;
  result: {
    valid: boolean;
    items: Array<{
      citationRef: string;
      validity: CitationSetValidity;
      reasonCode: string | null;
    }>;
    validatedAtVersion: string;
  };
};
