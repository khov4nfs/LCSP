import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "./agentic-tool.ts";

export const LEGAL_BASIS_RETRIEVAL_VALUES = {
  matched: "MATCHED",
  notFound: "NOT_FOUND",
} as const;

export type LegalBasisRetrievalValue =
  (typeof LEGAL_BASIS_RETRIEVAL_VALUES)[keyof typeof LEGAL_BASIS_RETRIEVAL_VALUES];

export const LEGAL_BASIS_CONTEXT_ROLES = {
  primaryMatch: "PRIMARY_MATCH",
  parentContext: "PARENT_CONTEXT",
  referencedContext: "REFERENCED_CONTEXT",
} as const;

export type LegalBasisContextRole =
  (typeof LEGAL_BASIS_CONTEXT_ROLES)[keyof typeof LEGAL_BASIS_CONTEXT_ROLES];

export const LEGAL_BASIS_EFFECTIVE_STATUSES = {
  effective: "EFFECTIVE",
} as const;

export type LegalBasisEffectiveStatus =
  (typeof LEGAL_BASIS_EFFECTIVE_STATUSES)[keyof typeof LEGAL_BASIS_EFFECTIVE_STATUSES];

export const LEGAL_BASIS_RETRIEVABLE_CHUNK_STATUSES = {
  active: "ACTIVE",
  amended: "AMENDED",
} as const;

export const LEGAL_BASIS_RETRIEVABLE_SOURCE_EFFECT_STATUSES = {
  effective: "CON_HIEU_LUC",
  partiallyExpired: "HET_HIEU_LUC_MOT_PHAN",
} as const;

export const LEGAL_BASIS_RETRIEVAL_LIMITATION_CODES = {
  indexValidationFailed: "INDEX_VALIDATION_FAILED",
  noEffectiveChunkForSelector: "NO_EFFECTIVE_CHUNK_FOR_SELECTOR",
  resultLimitReached: "RESULT_LIMIT_REACHED",
  retrievalUnavailable: "RETRIEVAL_UNAVAILABLE",
} as const;

export type LegalBasisRetrievalLimitationCode =
  (typeof LEGAL_BASIS_RETRIEVAL_LIMITATION_CODES)[keyof typeof LEGAL_BASIS_RETRIEVAL_LIMITATION_CODES];

export const RETRIEVE_LEGAL_BASIS_TOOL = {
  name: "retrieve_legal_basis",
  version: "1.0.0",
  configHash: "sha256:structure-retrieval-v1",
  maxCitations: 15,
  maxExcerptCharacters: 800,
  maxSelectors: 5,
} as const;

const STABLE_CORPUS_REF = "^corpus_[A-Za-z0-9_-]{8,80}$";
const STABLE_RULE_REF = "^rule_[A-Za-z0-9_-]{6,80}$";
const STABLE_CHUNK_REF = "^chunk_[A-Za-z0-9_-]{6,80}$";

export const RETRIEVE_LEGAL_BASIS_INPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["corpusVersionId", "selectors", "includeContext"],
  properties: {
    corpusVersionId: { type: "string", pattern: STABLE_CORPUS_REF },
    selectors: {
      type: "object",
      additionalProperties: false,
      minProperties: 1,
      properties: {
        ruleIds: {
          type: "array",
          minItems: 1,
          maxItems: RETRIEVE_LEGAL_BASIS_TOOL.maxSelectors,
          uniqueItems: true,
          items: { type: "string", pattern: STABLE_RULE_REF },
        },
        chunkIds: {
          type: "array",
          minItems: 1,
          maxItems: RETRIEVE_LEGAL_BASIS_TOOL.maxSelectors,
          uniqueItems: true,
          items: { type: "string", pattern: STABLE_CHUNK_REF },
        },
      },
    },
    includeContext: { type: "boolean" },
  },
} as const;

export const RETRIEVE_LEGAL_BASIS_RESULT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["outcome", "citations", "nextCursor"],
  properties: {
    outcome: { enum: Object.values(LEGAL_BASIS_RETRIEVAL_VALUES) },
    citations: {
      type: "array",
      maxItems: RETRIEVE_LEGAL_BASIS_TOOL.maxCitations,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "chunkId",
          "locator",
          "contextRole",
          "effectiveStatus",
          "excerpt",
          "contentHash",
        ],
        properties: {
          chunkId: { type: "string", pattern: STABLE_CHUNK_REF },
          locator: { type: "string", maxLength: 256 },
          contextRole: { enum: Object.values(LEGAL_BASIS_CONTEXT_ROLES) },
          effectiveStatus: {
            enum: Object.values(LEGAL_BASIS_EFFECTIVE_STATUSES),
          },
          excerpt: {
            type: "string",
            maxLength: RETRIEVE_LEGAL_BASIS_TOOL.maxExcerptCharacters,
          },
          contentHash: { type: "string", pattern: "^sha256:[a-fA-F0-9]{64}$" },
        },
      },
    },
    nextCursor: { type: "null" },
  },
} as const;

export type RetrieveLegalBasisInput = {
  corpusVersionId: string;
  selectors: {
    ruleIds?: string[];
    chunkIds?: string[];
  };
  includeContext: boolean;
};

export type LegalBasisRetrievalLimitation = {
  code: LegalBasisRetrievalLimitationCode;
  affectedScopeRef: string | null;
  reason: string;
  retryable: boolean;
};

export type RetrieveLegalBasisResponse = {
  status: AgenticToolStatus;
  toolName: AgenticToolName;
  toolVersion: string;
  configHash: string;
  correlationId: string;
  artifactVersions: {
    corpusVersionId: string;
    retrievalIndexId: string | null;
  };
  provenanceRef: string;
  coverageState: AgenticToolCoverageState;
  evidenceRefs: string[];
  limitations: LegalBasisRetrievalLimitation[];
  result: {
    outcome: LegalBasisRetrievalValue;
    citations: Array<{
      chunkId: string;
      locator: string;
      contextRole: LegalBasisContextRole;
      effectiveStatus: LegalBasisEffectiveStatus;
      excerpt: string;
      contentHash: string;
    }>;
    nextCursor: null;
  };
};
