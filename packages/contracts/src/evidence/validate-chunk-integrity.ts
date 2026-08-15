import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "./agentic-tool.ts";

export const CHUNK_INTEGRITY_VALIDATION_PROFILES = {
  legalIntegrityV1: "LEGAL_INTEGRITY_V1",
} as const;

export type ChunkIntegrityValidationProfile =
  (typeof CHUNK_INTEGRITY_VALIDATION_PROFILES)[keyof typeof CHUNK_INTEGRITY_VALIDATION_PROFILES];

export const CHUNK_INTEGRITY_DECISIONS = {
  pass: "PASS",
  fail: "FAIL",
  blocked: "BLOCKED",
} as const;

export type ChunkIntegrityDecision =
  (typeof CHUNK_INTEGRITY_DECISIONS)[keyof typeof CHUNK_INTEGRITY_DECISIONS];

export const VALIDATE_CHUNK_INTEGRITY_TOOL = {
  name: "validate_chunk_integrity",
  version: "1.0.0",
  configHash: "sha256:integrity-v1",
} as const;

export const VALIDATE_CHUNK_INTEGRITY_LIMITATION_CODES = {
  chunkSetMissing: "CHUNK_SET_MISSING",
  chunkArtifactMissing: "CHUNK_ARTIFACT_MISSING",
  chunkManifestHashMismatch: "CHUNK_MANIFEST_HASH_MISMATCH",
  chunkContentHashMismatch: "CHUNK_CONTENT_HASH_MISMATCH",
  duplicateChunkId: "DUPLICATE_CHUNK_ID",
  duplicateLocator: "DUPLICATE_LOCATOR",
  orphanParent: "ORPHAN_PARENT",
  locatorIdMismatch: "LOCATOR_ID_MISMATCH",
  xrefTargetMissing: "XREF_TARGET_MISSING",
  relationshipManifestMissing: "RELATIONSHIP_MANIFEST_MISSING",
  relationshipChunkSetMismatch: "RELATIONSHIP_CHUNK_SET_MISMATCH",
  repealTargetMissing: "REPEAL_TARGET_MISSING",
  repealStatusMismatch: "REPEAL_STATUS_MISMATCH",
  repealRefMismatch: "REPEAL_REF_MISMATCH",
  legalEffectStatusConflict: "LEGAL_EFFECT_STATUS_CONFLICT",
  unsupportedSourceEffectStatus: "UNSUPPORTED_SOURCE_EFFECT_STATUS",
} as const;

export type ValidateChunkIntegrityLimitationCode =
  (typeof VALIDATE_CHUNK_INTEGRITY_LIMITATION_CODES)[keyof typeof VALIDATE_CHUNK_INTEGRITY_LIMITATION_CODES];

export const CHUNK_INTEGRITY_RULES = {
  hashes: "HASHES",
  hierarchy: "HIERARCHY",
  locators: "LOCATORS",
  xrefs: "XREFS",
  effectStatus: "EFFECT_STATUS",
  repealMapping: "REPEAL_MAPPING",
} as const;

export type ChunkIntegrityRule =
  (typeof CHUNK_INTEGRITY_RULES)[keyof typeof CHUNK_INTEGRITY_RULES];

const STABLE_CHUNK_SET_REF = "^chunk-set:[A-Za-z0-9:_-]{8,220}$";
const STABLE_RELATIONSHIP_REF =
  "^relationship-manifest:[A-Za-z0-9:_-]{8,220}$";
const STABLE_INTEGRITY_REF = "^integrity-manifest:[A-Za-z0-9:_-]{8,220}$";

export const VALIDATE_CHUNK_INTEGRITY_INPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    chunkSetRef: { type: "string", pattern: STABLE_CHUNK_SET_REF },
    relationshipManifestRef: {
      type: "string",
      pattern: STABLE_RELATIONSHIP_REF,
    },
    validationProfile: {
      const: CHUNK_INTEGRITY_VALIDATION_PROFILES.legalIntegrityV1,
    },
  },
  required: ["chunkSetRef", "relationshipManifestRef", "validationProfile"],
} as const;

export const VALIDATE_CHUNK_INTEGRITY_RESULT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "validationManifestRef",
    "decision",
    "checkedRules",
    "findingRefs",
  ],
  properties: {
    validationManifestRef: { type: "string", pattern: STABLE_INTEGRITY_REF },
    decision: {
      enum: [
        CHUNK_INTEGRITY_DECISIONS.pass,
        CHUNK_INTEGRITY_DECISIONS.fail,
        CHUNK_INTEGRITY_DECISIONS.blocked,
      ],
    },
    checkedRules: {
      type: "array",
      minItems: 1,
      items: {
        enum: [
          CHUNK_INTEGRITY_RULES.hashes,
          CHUNK_INTEGRITY_RULES.hierarchy,
          CHUNK_INTEGRITY_RULES.locators,
          CHUNK_INTEGRITY_RULES.xrefs,
          CHUNK_INTEGRITY_RULES.effectStatus,
          CHUNK_INTEGRITY_RULES.repealMapping,
        ],
      },
    },
    findingRefs: {
      type: "array",
      items: { type: "string", minLength: 8, maxLength: 220 },
    },
  },
} as const;

export type ValidateChunkIntegrityRequest = {
  chunkSetRef: string;
  relationshipManifestRef: string;
  validationProfile: ChunkIntegrityValidationProfile;
};

export type ValidateChunkIntegrityLimitation = {
  code: ValidateChunkIntegrityLimitationCode | string;
  affectedScopeRef: string | null;
  reason: string;
  retryable: boolean;
};

export type ValidateChunkIntegrityResponse = {
  status: AgenticToolStatus;
  toolName: AgenticToolName;
  toolVersion: string;
  configHash: string;
  correlationId: string;
  artifactVersions: {
    chunkSetId: string;
    integrityManifestId: string;
  };
  provenanceRef: string;
  coverageState: AgenticToolCoverageState;
  evidenceRefs: string[];
  limitations: ValidateChunkIntegrityLimitation[];
  result: {
    validationManifestRef: string;
    decision: ChunkIntegrityDecision;
    checkedRules: ChunkIntegrityRule[];
    findingRefs: string[];
  };
};
