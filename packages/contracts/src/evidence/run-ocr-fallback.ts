import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "./agentic-tool.ts";

export const OCR_FALLBACK_PROFILES = {
  viOfficialV1: "VI_OFFICIAL_V1",
} as const;

export type OcrFallbackProfile =
  (typeof OCR_FALLBACK_PROFILES)[keyof typeof OCR_FALLBACK_PROFILES];

export const OCR_FALLBACK_LIMITATION_CODES = {
  ocrRequired: "OCR_REQUIRED",
  fallbackProofMissing: "FALLBACK_PROOF_MISSING",
  canonicalExtractionSufficient: "CANONICAL_EXTRACTION_SUFFICIENT",
  unsupportedSnapshotType: "UNSUPPORTED_SNAPSHOT_TYPE",
  missingPage: "MISSING_PAGE",
} as const;

export type OcrFallbackLimitationCode =
  (typeof OCR_FALLBACK_LIMITATION_CODES)[keyof typeof OCR_FALLBACK_LIMITATION_CODES];

export const RUN_OCR_FALLBACK_TOOL = {
  name: "run_ocr_fallback",
  version: "1.0.0",
  configHash: "sha256:ocr-vi-v1",
  maxPagesPerRequest: 200,
} as const;

const STABLE_SNAPSHOT_REF = "^snapshot:[A-Za-z0-9:_-]{8,180}$";
const STABLE_PROOF_REF = "^prov:extract:[A-Za-z0-9:_-]{3,220}$";
const STABLE_OCR_REF = "^ocr:[A-Za-z0-9:_-]{8,220}$";
const STABLE_PROVENANCE_REF = "^prov:ocr:[A-Za-z0-9:_-]{3,220}$";
const STABLE_SHA = "^sha256:[a-fA-F0-9]{64}$";

export const RUN_OCR_FALLBACK_INPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    snapshotRef: { type: "string", pattern: STABLE_SNAPSHOT_REF },
    fallbackProofRef: { type: "string", pattern: STABLE_PROOF_REF },
    pageNumbers: {
      type: "array",
      minItems: 1,
      maxItems: RUN_OCR_FALLBACK_TOOL.maxPagesPerRequest,
      uniqueItems: true,
      items: { type: "integer", minimum: 1, maximum: 2000 },
    },
    ocrProfile: {
      const: OCR_FALLBACK_PROFILES.viOfficialV1,
    },
  },
  required: ["snapshotRef", "fallbackProofRef", "pageNumbers", "ocrProfile"],
} as const;

export const RUN_OCR_FALLBACK_RESULT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ocrRef", "pages", "profile"],
  properties: {
    ocrRef: { type: "string", pattern: STABLE_OCR_REF },
    pages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["page", "pageImageSha256", "spanManifestRef", "meanConfidence"],
        properties: {
          page: { type: "integer", minimum: 1 },
          pageImageSha256: { type: "string", pattern: STABLE_SHA },
          spanManifestRef: { type: "string", minLength: 8, maxLength: 220 },
          meanConfidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    profile: { const: OCR_FALLBACK_PROFILES.viOfficialV1 },
  },
} as const;

export type RunOcrFallbackInput = {
  snapshotRef: string;
  fallbackProofRef: string;
  pageNumbers: number[];
  ocrProfile: OcrFallbackProfile;
};

export type RunOcrFallbackLimitation = {
  code: OcrFallbackLimitationCode | string;
  affectedScopeRef: string | null;
  reason: string;
  retryable: boolean;
};

export type RunOcrFallbackResponse = {
  status: AgenticToolStatus;
  toolName: AgenticToolName;
  toolVersion: string;
  configHash: string;
  correlationId: string;
  artifactVersions: {
    snapshotId: string;
    ocrId: string;
  };
  provenanceRef: string;
  coverageState: AgenticToolCoverageState;
  evidenceRefs: string[];
  limitations: RunOcrFallbackLimitation[];
  result: {
    ocrRef: string;
    pages: Array<{
      page: number;
      pageImageSha256: string;
      spanManifestRef: string;
      meanConfidence: number;
    }>;
    profile: OcrFallbackProfile;
  };
};
