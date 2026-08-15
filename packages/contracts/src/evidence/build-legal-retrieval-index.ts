import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "./agentic-tool.ts";

export const LEGAL_RETRIEVAL_INDEX_PROFILES = {
  chromaStructureV1: "CHROMA_STRUCTURE_V1",
} as const;

export type LegalRetrievalIndexProfile =
  (typeof LEGAL_RETRIEVAL_INDEX_PROFILES)[keyof typeof LEGAL_RETRIEVAL_INDEX_PROFILES];

export const BUILD_LEGAL_RETRIEVAL_INDEX_TOOL = {
  name: "build_legal_retrieval_index",
  version: "1.0.0",
  configHash: "sha256:chroma-structure-v1",
} as const;

export const BUILD_LEGAL_RETRIEVAL_INDEX_LIMITATION_CODES = {
  chunkSetMissing: "CHUNK_SET_MISSING",
  integrityManifestMissing: "INTEGRITY_MANIFEST_MISSING",
  integrityGateBlocked: "INTEGRITY_GATE_BLOCKED",
  integrityManifestMismatch: "INTEGRITY_MANIFEST_MISMATCH",
  chunkArtifactMissing: "CHUNK_ARTIFACT_MISSING",
  invalidChunkMetadata: "INVALID_CHUNK_METADATA",
  chromaWriteFailed: "CHROMA_WRITE_FAILED",
  indexChecksumMismatch: "INDEX_CHECKSUM_MISMATCH",
} as const;

export type BuildLegalRetrievalIndexLimitationCode =
  (typeof BUILD_LEGAL_RETRIEVAL_INDEX_LIMITATION_CODES)[keyof typeof BUILD_LEGAL_RETRIEVAL_INDEX_LIMITATION_CODES];

const STABLE_CHUNK_SET_REF = "^chunk-set:[A-Za-z0-9:_-]{8,220}$";
const STABLE_INTEGRITY_REF = "^integrity-manifest:[A-Za-z0-9:_-]{8,220}$";
const STABLE_INDEX_REF = "^legal-index:[A-Za-z0-9:_-]{8,220}$";
const STABLE_SHA = "^sha256:[a-fA-F0-9]{64}$";

export const BUILD_LEGAL_RETRIEVAL_INDEX_INPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    chunkSetRef: { type: "string", pattern: STABLE_CHUNK_SET_REF },
    integrityManifestRef: { type: "string", pattern: STABLE_INTEGRITY_REF },
    indexProfile: { const: LEGAL_RETRIEVAL_INDEX_PROFILES.chromaStructureV1 },
  },
  required: ["chunkSetRef", "integrityManifestRef", "indexProfile"],
} as const;

export const BUILD_LEGAL_RETRIEVAL_INDEX_RESULT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "indexRef",
    "collectionName",
    "indexChecksum",
    "indexedChunkCount",
    "profile",
  ],
  properties: {
    indexRef: { type: "string", pattern: STABLE_INDEX_REF },
    collectionName: { type: "string", minLength: 8, maxLength: 220 },
    indexChecksum: { type: "string", pattern: STABLE_SHA },
    indexedChunkCount: { type: "integer", minimum: 0 },
    profile: { const: LEGAL_RETRIEVAL_INDEX_PROFILES.chromaStructureV1 },
  },
} as const;

export type BuildLegalRetrievalIndexRequest = {
  chunkSetRef: string;
  integrityManifestRef: string;
  indexProfile: LegalRetrievalIndexProfile;
};

export type BuildLegalRetrievalIndexLimitation = {
  code: BuildLegalRetrievalIndexLimitationCode | string;
  affectedScopeRef: string | null;
  reason: string;
  retryable: boolean;
};

export type BuildLegalRetrievalIndexResponse = {
  status: AgenticToolStatus;
  toolName: AgenticToolName;
  toolVersion: string;
  configHash: string;
  correlationId: string;
  artifactVersions: {
    chunkSetId: string;
    indexId: string;
  };
  provenanceRef: string;
  coverageState: AgenticToolCoverageState;
  evidenceRefs: string[];
  limitations: BuildLegalRetrievalIndexLimitation[];
  result: {
    indexRef: string;
    collectionName: string;
    indexChecksum: string;
    indexedChunkCount: number;
    profile: LegalRetrievalIndexProfile;
  };
};
