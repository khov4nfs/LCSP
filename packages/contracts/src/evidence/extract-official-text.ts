import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "./agentic-tool.ts";

export const OFFICIAL_TEXT_EXTRACTION_PROFILES = {
  htmlOfficialV1: "HTML_OFFICIAL_V1",
  docxOfficialV1: "DOCX_OFFICIAL_V1",
} as const;

export type OfficialTextExtractionProfile =
  (typeof OFFICIAL_TEXT_EXTRACTION_PROFILES)[keyof typeof OFFICIAL_TEXT_EXTRACTION_PROFILES];

export const OFFICIAL_TEXT_EXTRACTION_LIMITATION_CODES = {
  malformedSnapshot: "MALFORMED_SNAPSHOT",
  unsupportedProfile: "UNSUPPORTED_PROFILE",
  identityMissing: "IDENTITY_MISSING",
  extractionUnavailable: "EXTRACTION_UNAVAILABLE",
} as const;

export type OfficialTextExtractionLimitationCode =
  (typeof OFFICIAL_TEXT_EXTRACTION_LIMITATION_CODES)[keyof typeof OFFICIAL_TEXT_EXTRACTION_LIMITATION_CODES];

export const EXTRACT_OFFICIAL_TEXT_TOOL = {
  name: "extract_official_text",
  version: "1.0.0",
  configHash: "sha256:official-text-extraction-v1",
  maxPages: 2_000,
  maxEvidenceRefs: 10,
} as const;

const STABLE_SNAPSHOT_REF = "^snapshot:[A-Za-z0-9:_-]{8,180}$";
const STABLE_EXTRACTION_REF = "^extraction:[A-Za-z0-9:_-]{8,220}$";
const STABLE_SPAN_REF = "^span:[A-Za-z0-9:_-]{8,220}:p\\d+:s\\d+$";
const STABLE_SHA = "^sha256:[a-fA-F0-9]{64}$";

export const EXTRACT_OFFICIAL_TEXT_INPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    snapshotRef: { type: "string", pattern: STABLE_SNAPSHOT_REF },
    extractorProfile: {
      enum: Object.values(OFFICIAL_TEXT_EXTRACTION_PROFILES),
    },
    maxPages: {
      type: "integer",
      minimum: 1,
      maximum: EXTRACT_OFFICIAL_TEXT_TOOL.maxPages,
    },
  },
  required: ["snapshotRef", "extractorProfile", "maxPages"],
} as const;

export const EXTRACT_OFFICIAL_TEXT_RESULT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "extractionRef",
    "format",
    "pageCount",
    "spanCount",
    "identityCandidate",
    "spanManifestSha256",
    "canonicalExtractionAvailable",
  ],
  properties: {
    extractionRef: { type: "string", pattern: STABLE_EXTRACTION_REF },
    format: { enum: ["HTML", "DOCX"] },
    pageCount: { type: "integer", minimum: 1 },
    spanCount: { type: "integer", minimum: 0 },
    identityCandidate: {
      type: "object",
      additionalProperties: false,
      required: ["documentNumber", "sourceEffectStatus"],
      properties: {
        documentNumber: { type: ["string", "null"], maxLength: 64 },
        sourceEffectStatus: { type: ["string", "null"], maxLength: 64 },
        effectiveFrom: { type: ["string", "null"], maxLength: 64 },
      },
    },
    spanManifestSha256: { type: "string", pattern: STABLE_SHA },
    canonicalExtractionAvailable: { type: "boolean" },
  },
} as const;

export type ExtractOfficialTextInput = {
  snapshotRef: string;
  extractorProfile: OfficialTextExtractionProfile;
  maxPages: number;
};

export type ExtractOfficialTextLimitation = {
  code: OfficialTextExtractionLimitationCode | string;
  affectedScopeRef: string | null;
  reason: string;
  retryable: boolean;
};

export type ExtractOfficialTextResponse = {
  status: AgenticToolStatus;
  toolName: AgenticToolName;
  toolVersion: string;
  configHash: string;
  correlationId: string;
  artifactVersions: {
    snapshotId: string;
    extractionId: string;
  };
  provenanceRef: string;
  coverageState: AgenticToolCoverageState;
  evidenceRefs: string[];
  limitations: ExtractOfficialTextLimitation[];
  result: {
    extractionRef: string;
    format: "HTML" | "DOCX";
    pageCount: number;
    spanCount: number;
    identityCandidate: {
      documentNumber: string | null;
      sourceEffectStatus: string | null;
      effectiveFrom?: string | null;
    };
    spanManifestSha256: string;
    canonicalExtractionAvailable: boolean;
  };
};
