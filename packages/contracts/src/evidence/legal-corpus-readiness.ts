import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "./agentic-tool.ts";

export const LEGAL_CORPUS_READINESS_VALUES = {
  ready: "READY",
  corpusUnavailable: "CORPUS_UNAVAILABLE",
  indexInvalid: "INDEX_INVALID",
} as const;

export type LegalCorpusReadiness =
  (typeof LEGAL_CORPUS_READINESS_VALUES)[keyof typeof LEGAL_CORPUS_READINESS_VALUES];

export const LEGAL_CORPUS_READINESS_REQUIREMENTS = {
  approvedCorpus: "APPROVED_CORPUS",
  validRetrievalIndex: "VALID_RETRIEVAL_INDEX",
} as const;

export type LegalCorpusReadinessRequirement =
  (typeof LEGAL_CORPUS_READINESS_REQUIREMENTS)[keyof typeof LEGAL_CORPUS_READINESS_REQUIREMENTS];

export const LEGAL_CORPUS_READINESS_LIMITATION_CODES = {
  corpusUnavailable: "CORPUS_UNAVAILABLE",
  indexValidationFailed: "INDEX_VALIDATION_FAILED",
  projectionUnavailable: "PROJECTION_UNAVAILABLE",
} as const;

export type LegalCorpusReadinessLimitationCode =
  (typeof LEGAL_CORPUS_READINESS_LIMITATION_CODES)[keyof typeof LEGAL_CORPUS_READINESS_LIMITATION_CODES];

export const GET_LEGAL_CORPUS_READINESS_TOOL = {
  name: "get_legal_corpus_readiness",
  version: "1.0.0",
  configHash: "sha256:legal-corpus-readiness-v1",
} as const;

export const GET_LEGAL_CORPUS_READINESS_INPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    effectiveDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    pinnedCorpusVersionId: {
      type: "string",
      pattern: "^corpus_[A-Za-z0-9_-]{8,80}$",
    },
  },
  required: ["effectiveDate"],
} as const;

export const GET_LEGAL_CORPUS_READINESS_RESULT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "corpusVersionId",
    "indexVersionId",
    "readiness",
    "effectiveDate",
    "missingRequirements",
  ],
  properties: {
    corpusVersionId: { type: ["string", "null"] },
    indexVersionId: { type: ["string", "null"] },
    readiness: { enum: Object.values(LEGAL_CORPUS_READINESS_VALUES) },
    effectiveDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    missingRequirements: {
      type: "array",
      items: { enum: Object.values(LEGAL_CORPUS_READINESS_REQUIREMENTS) },
    },
  },
} as const;

export type GetLegalCorpusReadinessInput = {
  effectiveDate: string;
  pinnedCorpusVersionId?: string;
};

export type LegalCorpusReadinessLimitation = {
  code: LegalCorpusReadinessLimitationCode;
  affectedScopeRef: string | null;
  reason: string;
  retryable: boolean;
};

export type GetLegalCorpusReadinessResponse = {
  status: AgenticToolStatus;
  toolName: AgenticToolName;
  toolVersion: string;
  configHash: string;
  correlationId: string;
  artifactVersions: {
    corpusVersionId: string | null;
    retrievalIndexId: string | null;
  };
  provenanceRef: string;
  coverageState: AgenticToolCoverageState;
  evidenceRefs: string[];
  limitations: LegalCorpusReadinessLimitation[];
  result: {
    corpusVersionId: string | null;
    indexVersionId: string | null;
    readiness: LegalCorpusReadiness;
    effectiveDate: string;
    missingRequirements: LegalCorpusReadinessRequirement[];
  };
};
