import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "./agentic-tool.ts";

export const GAP_MATRIX_ROW_STATUSES = {
  satisfied: "SATISFIED",
  missing: "MISSING",
  contradicted: "CONTRADICTED",
  unknown: "UNKNOWN",
  outOfCoverage: "OUT_OF_COVERAGE",
} as const;

export type GapMatrixRowStatus =
  (typeof GAP_MATRIX_ROW_STATUSES)[keyof typeof GAP_MATRIX_ROW_STATUSES];

export const GAP_MATRIX_RESOLVER_TYPES = {
  collectEvidence: "COLLECT_EVIDENCE",
  refreshClassification: "REFRESH_CLASSIFICATION",
  reviewCitations: "REVIEW_CITATIONS",
} as const;

export type GapMatrixResolverType =
  (typeof GAP_MATRIX_RESOLVER_TYPES)[keyof typeof GAP_MATRIX_RESOLVER_TYPES];

export const GAP_MATRIX_RATIONALE_CODES = {
  verifiedEvidencePresent: "VERIFIED_EVIDENCE_PRESENT",
  noVerifiedEvidence: "NO_VERIFIED_EVIDENCE",
  coverageLimited: "COVERAGE_LIMITED",
  malformedClassificationField: "MALFORMED_CLASSIFICATION_FIELD",
  citationOutOfAllowlist: "CITATION_OUT_OF_ALLOWLIST",
} as const;

export type GapMatrixRationaleCode =
  (typeof GAP_MATRIX_RATIONALE_CODES)[keyof typeof GAP_MATRIX_RATIONALE_CODES];

export const GAP_MATRIX_LIMITATION_CODES = {
  matrixUnavailable: "GAP_MATRIX_UNAVAILABLE",
  classificationBlocked: "CLASSIFICATION_GUARDRAIL_BLOCKED",
  legalMatchBlocked: "LEGAL_RULE_MATCH_GUARDRAIL_BLOCKED",
} as const;

export type GapMatrixLimitationCode =
  (typeof GAP_MATRIX_LIMITATION_CODES)[keyof typeof GAP_MATRIX_LIMITATION_CODES];

export const EVALUATE_GAP_MATRIX_TOOL = {
  name: "evaluate_gap_matrix",
  version: "1.0.0",
  configHash: "sha256:gap-evaluator-v1",
  maxEvidenceRefs: 100,
  maxRows: 100,
} as const;

const STABLE_MATRIX_REF = "^matrix:[A-Za-z0-9_-]{6,80}$";
const STABLE_EVIDENCE_REF = "^(evidence|citation|coverage):[A-Za-z0-9:_-]{6,100}$";
const STABLE_ROW_REF = "^gap-row:[A-Za-z0-9:_-]{6,120}$";

export const EVALUATE_GAP_MATRIX_INPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["matrixRef", "evidenceRefs"],
  properties: {
    matrixRef: { type: "string", pattern: STABLE_MATRIX_REF },
    evidenceRefs: {
      type: "array",
      minItems: 1,
      maxItems: EVALUATE_GAP_MATRIX_TOOL.maxEvidenceRefs,
      uniqueItems: true,
      items: { type: "string", pattern: STABLE_EVIDENCE_REF },
    },
  },
} as const;

export const EVALUATE_GAP_MATRIX_RESULT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rows"],
  properties: {
    rows: {
      type: "array",
      maxItems: EVALUATE_GAP_MATRIX_TOOL.maxRows,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "rowRef",
          "status",
          "evidenceRefs",
          "rationaleCode",
          "resolverType",
        ],
        properties: {
          rowRef: { type: "string", pattern: STABLE_ROW_REF },
          status: { enum: Object.values(GAP_MATRIX_ROW_STATUSES) },
          evidenceRefs: {
            type: "array",
            maxItems: EVALUATE_GAP_MATRIX_TOOL.maxEvidenceRefs,
            items: { type: "string", pattern: STABLE_EVIDENCE_REF },
          },
          rationaleCode: {
            enum: Object.values(GAP_MATRIX_RATIONALE_CODES),
          },
          resolverType: {
            enum: Object.values(GAP_MATRIX_RESOLVER_TYPES),
          },
        },
      },
    },
  },
} as const;

export type EvaluateGapMatrixInput = {
  matrixRef: string;
  evidenceRefs: string[];
};

export type EvaluateGapMatrixResponse = {
  status: AgenticToolStatus;
  toolName: AgenticToolName;
  toolVersion: string;
  configHash: string;
  correlationId: string;
  artifactVersions: { matrixRef: string };
  provenanceRef: string;
  coverageState: AgenticToolCoverageState;
  evidenceRefs: string[];
  limitations: Array<{
    code: GapMatrixLimitationCode;
    affectedScopeRef: string | null;
    reason: string;
    retryable: boolean;
  }>;
  result: {
    rows: Array<{
      rowRef: string;
      status: GapMatrixRowStatus;
      evidenceRefs: string[];
      rationaleCode: GapMatrixRationaleCode;
      resolverType: GapMatrixResolverType;
    }>;
  };
};
