import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "./agentic-tool.ts";

export const REVIEWED_CORPUS_CORRECTION_PROFILES = {
  deterministicV1: "DETERMINISTIC_V1",
} as const;

export type ReviewedCorpusCorrectionProfile =
  (typeof REVIEWED_CORPUS_CORRECTION_PROFILES)[keyof typeof REVIEWED_CORPUS_CORRECTION_PROFILES];

export const BUILD_REVIEWED_CORPUS_INPUT_TOOL = {
  name: "build_reviewed_corpus_input",
  version: "1.0.0",
  configHash: "sha256:normalizer-v1",
} as const;

export const BUILD_REVIEWED_CORPUS_INPUT_LIMITATION_CODES = {
  qualityManifestMissing: "QUALITY_MANIFEST_MISSING",
  extractionMissing: "EXTRACTION_MISSING",
  qualityGateBlocked: "QUALITY_GATE_BLOCKED",
  qualityManifestMismatch: "QUALITY_MANIFEST_MISMATCH",
  artifactMissing: "ARTIFACT_MISSING",
  artifactHashMismatch: "ARTIFACT_HASH_MISMATCH",
  unsupportedCorrectionProfile: "UNSUPPORTED_CORRECTION_PROFILE",
} as const;

export type BuildReviewedCorpusInputLimitationCode =
  (typeof BUILD_REVIEWED_CORPUS_INPUT_LIMITATION_CODES)[keyof typeof BUILD_REVIEWED_CORPUS_INPUT_LIMITATION_CODES];

const STABLE_EXTRACTION_REF = "^(extraction|ocr):[A-Za-z0-9:_-]{3,220}$";
const STABLE_QUALITY_REF = "^quality-manifest:[A-Za-z0-9:_-]{8,220}$";
const STABLE_REVIEWED_INPUT_REF = "^reviewed-input:[A-Za-z0-9:_-]{8,220}$";
const STABLE_SHA = "^sha256:[a-fA-F0-9]{64}$";

export const BUILD_REVIEWED_CORPUS_INPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    extractionRef: { type: "string", pattern: STABLE_EXTRACTION_REF },
    qualityManifestRef: { type: "string", pattern: STABLE_QUALITY_REF },
    correctionProfile: {
      const: REVIEWED_CORPUS_CORRECTION_PROFILES.deterministicV1,
    },
  },
  required: ["extractionRef", "qualityManifestRef", "correctionProfile"],
} as const;

export const BUILD_REVIEWED_CORPUS_INPUT_RESULT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "reviewedInputRef",
    "contentSha256",
    "correctionProfile",
    "qualityDecision",
    "manualApprovalRequired",
  ],
  properties: {
    reviewedInputRef: { type: "string", pattern: STABLE_REVIEWED_INPUT_REF },
    contentSha256: { type: "string", pattern: STABLE_SHA },
    correctionProfile: {
      const: REVIEWED_CORPUS_CORRECTION_PROFILES.deterministicV1,
    },
    qualityDecision: { const: "PASS" },
    manualApprovalRequired: { const: false },
  },
} as const;

export type BuildReviewedCorpusInputRequest = {
  extractionRef: string;
  qualityManifestRef: string;
  correctionProfile: ReviewedCorpusCorrectionProfile;
};

export type BuildReviewedCorpusInputLimitation = {
  code: BuildReviewedCorpusInputLimitationCode | string;
  affectedScopeRef: string | null;
  reason: string;
  retryable: boolean;
};

export type BuildReviewedCorpusInputResponse = {
  status: AgenticToolStatus;
  toolName: AgenticToolName;
  toolVersion: string;
  configHash: string;
  correlationId: string;
  artifactVersions: {
    reviewedInputId: string;
  };
  provenanceRef: string;
  coverageState: AgenticToolCoverageState;
  evidenceRefs: string[];
  limitations: BuildReviewedCorpusInputLimitation[];
  result: {
    reviewedInputRef: string;
    contentSha256: string;
    correctionProfile: ReviewedCorpusCorrectionProfile;
    qualityDecision: "PASS";
    manualApprovalRequired: false;
  };
};
