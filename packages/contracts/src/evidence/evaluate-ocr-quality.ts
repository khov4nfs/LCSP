import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "./agentic-tool.ts";

export const OCR_QUALITY_PROFILES = {
  viLegalV1: "VI_LEGAL_V1",
} as const;

export type OcrQualityProfile =
  (typeof OCR_QUALITY_PROFILES)[keyof typeof OCR_QUALITY_PROFILES];

export const OCR_QUALITY_DECISIONS = {
  pass: "PASS",
} as const;

export type OcrQualityDecision =
  (typeof OCR_QUALITY_DECISIONS)[keyof typeof OCR_QUALITY_DECISIONS];

export const OCR_QUALITY_LIMITATION_CODES = {
  extractionMissing: "EXTRACTION_MISSING",
  identityRefMissing: "IDENTITY_REF_MISSING",
  genericIdentityRef: "GENERIC_IDENTITY_REF",
  missingIdentityCandidate: "MISSING_IDENTITY_CANDIDATE",
  identityMismatch: "IDENTITY_MISMATCH",
  pageContinuityGap: "PAGE_CONTINUITY_GAP",
  pageOrderMismatch: "PAGE_ORDER_MISMATCH",
  lowConfidence: "LOW_CONFIDENCE",
  numberingMissing: "NUMBERING_MISSING",
  hierarchyMissing: "HIERARCHY_MISSING",
  manifestMissing: "MANIFEST_MISSING",
  manifestHashMismatch: "MANIFEST_HASH_MISMATCH",
  textHashMismatch: "TEXT_HASH_MISMATCH",
} as const;

export type OcrQualityLimitationCode =
  (typeof OCR_QUALITY_LIMITATION_CODES)[keyof typeof OCR_QUALITY_LIMITATION_CODES];

export const EVALUATE_OCR_QUALITY_TOOL = {
  name: "evaluate_ocr_quality",
  version: "1.0.0",
  configHash: "sha256:quality-v1",
  minimumConfidence: 0.9,
} as const;

const STABLE_EXTRACTION_REF = "^(extraction|ocr):[A-Za-z0-9:_-]{3,220}$";
const STABLE_IDENTITY_REF = "^catalog-source:[a-z0-9:_-]{3,160}$";
const STABLE_QUALITY_REF = "^quality-manifest:[A-Za-z0-9:_-]{8,220}$";

export const EVALUATE_OCR_QUALITY_INPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    extractionRef: { type: "string", pattern: STABLE_EXTRACTION_REF },
    expectedIdentityRef: { type: "string", pattern: STABLE_IDENTITY_REF },
    qualityProfile: { const: OCR_QUALITY_PROFILES.viLegalV1 },
  },
  required: ["extractionRef", "expectedIdentityRef", "qualityProfile"],
} as const;

export const EVALUATE_OCR_QUALITY_RESULT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "qualityManifestRef",
    "decision",
    "checked",
    "minimumConfidence",
    "findingRefs",
  ],
  properties: {
    qualityManifestRef: { type: "string", pattern: STABLE_QUALITY_REF },
    decision: { const: OCR_QUALITY_DECISIONS.pass },
    checked: {
      type: "object",
      additionalProperties: false,
      required: [
        "pageContinuity",
        "identity",
        "numbering",
        "hierarchy",
      ],
      properties: {
        pageContinuity: { type: "boolean" },
        identity: { type: "boolean" },
        numbering: { type: "boolean" },
        hierarchy: { type: "boolean" },
      },
    },
    minimumConfidence: { type: "number", minimum: 0, maximum: 1 },
    findingRefs: {
      type: "array",
      items: { type: "string", minLength: 8, maxLength: 220 },
    },
  },
} as const;

export type EvaluateOcrQualityInput = {
  extractionRef: string;
  expectedIdentityRef: string;
  qualityProfile: OcrQualityProfile;
};

export type EvaluateOcrQualityLimitation = {
  code: OcrQualityLimitationCode | string;
  affectedScopeRef: string | null;
  reason: string;
  retryable: boolean;
};

export type EvaluateOcrQualityResponse = {
  status: AgenticToolStatus;
  toolName: AgenticToolName;
  toolVersion: string;
  configHash: string;
  correlationId: string;
  artifactVersions: {
    extractionId: string;
  };
  provenanceRef: string;
  coverageState: AgenticToolCoverageState;
  evidenceRefs: string[];
  limitations: EvaluateOcrQualityLimitation[];
  result: {
    qualityManifestRef: string;
    decision: OcrQualityDecision;
    checked: {
      pageContinuity: boolean;
      identity: boolean;
      numbering: boolean;
      hierarchy: boolean;
    };
    minimumConfidence: number;
    findingRefs: string[];
  };
};
