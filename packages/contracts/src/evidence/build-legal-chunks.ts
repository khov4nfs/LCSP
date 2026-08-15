import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "./agentic-tool.ts";

export const LEGAL_CHUNK_SCHEMA_VERSIONS = {
  legalChunkV1: "LEGAL_CHUNK_V1",
} as const;

export type LegalChunkSchemaVersion =
  (typeof LEGAL_CHUNK_SCHEMA_VERSIONS)[keyof typeof LEGAL_CHUNK_SCHEMA_VERSIONS];

export const BUILD_LEGAL_CHUNKS_TOOL = {
  name: "build_legal_chunks",
  version: "1.0.0",
  configHash: "sha256:chunk-v1",
} as const;

export const BUILD_LEGAL_CHUNKS_LIMITATION_CODES = {
  reviewedInputMissing: "REVIEWED_INPUT_MISSING",
  reviewedInputHashMismatch: "REVIEWED_INPUT_HASH_MISMATCH",
  duplicateLocator: "DUPLICATE_LOCATOR",
  malformedHierarchy: "MALFORMED_HIERARCHY",
  missingParent: "MISSING_PARENT",
} as const;

export type BuildLegalChunksLimitationCode =
  (typeof BUILD_LEGAL_CHUNKS_LIMITATION_CODES)[keyof typeof BUILD_LEGAL_CHUNKS_LIMITATION_CODES];

const STABLE_REVIEWED_INPUT_REF = "^reviewed-input:[A-Za-z0-9:_-]{8,220}$";
const STABLE_IDENTITY_REF = "^catalog-source:[a-z0-9:_-]{3,160}$";
const STABLE_CHUNK_SET_REF = "^chunk-set:[A-Za-z0-9:_-]{8,220}$";
const STABLE_SHA = "^sha256:[a-fA-F0-9]{64}$";

export const BUILD_LEGAL_CHUNKS_INPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reviewedInputRef: { type: "string", pattern: STABLE_REVIEWED_INPUT_REF },
    documentIdentityRef: { type: "string", pattern: STABLE_IDENTITY_REF },
    chunkSchemaVersion: { const: LEGAL_CHUNK_SCHEMA_VERSIONS.legalChunkV1 },
  },
  required: ["reviewedInputRef", "documentIdentityRef", "chunkSchemaVersion"],
} as const;

export const BUILD_LEGAL_CHUNKS_RESULT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "chunkSetRef",
    "chunkCount",
    "chunkManifestSha256",
    "schemaVersion",
    "sample",
  ],
  properties: {
    chunkSetRef: { type: "string", pattern: STABLE_CHUNK_SET_REF },
    chunkCount: { type: "integer", minimum: 1 },
    chunkManifestSha256: { type: "string", pattern: STABLE_SHA },
    schemaVersion: { const: LEGAL_CHUNK_SCHEMA_VERSIONS.legalChunkV1 },
    sample: {
      type: "object",
      additionalProperties: false,
      required: ["chunkId", "locator", "parentChunkId", "legalStatus"],
      properties: {
        chunkId: { type: "string", minLength: 8, maxLength: 220 },
        locator: { type: "string", minLength: 3, maxLength: 220 },
        parentChunkId: { type: ["string", "null"], minLength: 3, maxLength: 220 },
        legalStatus: { enum: ["ACTIVE", "REPEALED", "AMENDED"] },
      },
    },
  },
} as const;

export type BuildLegalChunksRequest = {
  reviewedInputRef: string;
  documentIdentityRef: string;
  chunkSchemaVersion: LegalChunkSchemaVersion;
};

export type BuildLegalChunksLimitation = {
  code: BuildLegalChunksLimitationCode | string;
  affectedScopeRef: string | null;
  reason: string;
  retryable: boolean;
};

export type BuildLegalChunksResponse = {
  status: AgenticToolStatus;
  toolName: AgenticToolName;
  toolVersion: string;
  configHash: string;
  correlationId: string;
  artifactVersions: {
    chunkSetId: string;
  };
  provenanceRef: string;
  coverageState: AgenticToolCoverageState;
  evidenceRefs: string[];
  limitations: BuildLegalChunksLimitation[];
  result: {
    chunkSetRef: string;
    chunkCount: number;
    chunkManifestSha256: string;
    schemaVersion: LegalChunkSchemaVersion;
    sample: {
      chunkId: string;
      locator: string;
      parentChunkId: string | null;
      legalStatus: "ACTIVE" | "REPEALED" | "AMENDED";
    };
  };
};
