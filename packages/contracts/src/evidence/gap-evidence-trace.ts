import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "./agentic-tool.ts";
import type { GapMatrixResolverType } from "./gap-matrix-evaluation.ts";

export const GAP_TRACE_LAYERS = {
  classificationResult: "CLASSIFICATION_RESULT",
  verifiedProfile: "VERIFIED_PROFILE",
  legalRuleMatch: "LEGAL_RULE_MATCH",
  technicalEvidence: "TECHNICAL_EVIDENCE",
  citationSet: "CITATION_SET",
} as const;

export type GapTraceLayer =
  (typeof GAP_TRACE_LAYERS)[keyof typeof GAP_TRACE_LAYERS];

export const GAP_TRACE_LIMITATION_CODES = {
  rowUnavailable: "GAP_TRACE_ROW_UNAVAILABLE",
  provenanceLimited: "GAP_TRACE_PROVENANCE_LIMITED",
} as const;

export type GapTraceLimitationCode =
  (typeof GAP_TRACE_LIMITATION_CODES)[keyof typeof GAP_TRACE_LIMITATION_CODES];

export const GET_GAP_EVIDENCE_TRACE_TOOL = {
  name: "get_gap_evidence_trace",
  version: "1.0.0",
  configHash: "sha256:gap-trace-v1",
  maxLayers: 8,
} as const;

const STABLE_ROW_REF = "^gap-row:[A-Za-z0-9:_-]{6,120}$";

export const GET_GAP_EVIDENCE_TRACE_INPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rowRef"],
  properties: {
    rowRef: { type: "string", pattern: STABLE_ROW_REF },
  },
} as const;

export const GET_GAP_EVIDENCE_TRACE_RESULT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rowRef", "layers", "resolverType"],
  properties: {
    rowRef: { type: "string", pattern: STABLE_ROW_REF },
    layers: {
      type: "array",
      maxItems: GET_GAP_EVIDENCE_TRACE_TOOL.maxLayers,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["layer", "artifactRef"],
        properties: {
          layer: { enum: Object.values(GAP_TRACE_LAYERS) },
          artifactRef: { type: "string", maxLength: 160 },
        },
      },
    },
    resolverType: {
      type: "string",
      enum: ["COLLECT_EVIDENCE", "REFRESH_CLASSIFICATION", "REVIEW_CITATIONS"],
    },
  },
} as const;

export type GetGapEvidenceTraceInput = {
  rowRef: string;
};

export type GetGapEvidenceTraceResponse = {
  status: AgenticToolStatus;
  toolName: AgenticToolName;
  toolVersion: string;
  configHash: string;
  correlationId: string;
  artifactVersions: { gapRowRef: string };
  provenanceRef: string;
  coverageState: AgenticToolCoverageState;
  evidenceRefs: string[];
  limitations: Array<{
    code: GapTraceLimitationCode;
    affectedScopeRef: string | null;
    reason: string;
    retryable: boolean;
  }>;
  result: {
    rowRef: string;
    layers: Array<{
      layer: GapTraceLayer;
      artifactRef: string;
    }>;
    resolverType: GapMatrixResolverType;
  };
};
