import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "./agentic-tool.ts";

export const GAP_REMEDIATION_TEMPLATE_IDS = {
  collectEvidence: "remediation:collect-evidence",
  resolveConflict: "remediation:resolve-conflict",
  expandCoverage: "remediation:expand-coverage",
} as const;

export type GapRemediationTemplateId =
  (typeof GAP_REMEDIATION_TEMPLATE_IDS)[keyof typeof GAP_REMEDIATION_TEMPLATE_IDS];

export const GAP_REMEDIATION_LIMITATION_CODES = {
  rowUnavailable: "GAP_REMEDIATION_ROW_UNAVAILABLE",
  staleSatisfiedRow: "GAP_REMEDIATION_STALE_SATISFIED_ROW",
  templateNotAllowed: "GAP_REMEDIATION_TEMPLATE_NOT_ALLOWED",
} as const;

export type GapRemediationLimitationCode =
  (typeof GAP_REMEDIATION_LIMITATION_CODES)[keyof typeof GAP_REMEDIATION_LIMITATION_CODES];

export const PROPOSE_GAP_REMEDIATION_TOOL = {
  name: "propose_gap_remediation",
  version: "1.0.0",
  configHash: "sha256:remediation-v1",
  maxProposalRefLength: 80,
} as const;

const STABLE_ROW_REF = "^gap-row:[A-Za-z0-9:_-]{6,120}$";

export const PROPOSE_GAP_REMEDIATION_INPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rowRef", "templateId"],
  properties: {
    rowRef: { type: "string", pattern: STABLE_ROW_REF },
    templateId: {
      type: "string",
      enum: Object.values(GAP_REMEDIATION_TEMPLATE_IDS),
    },
  },
} as const;

export const PROPOSE_GAP_REMEDIATION_RESULT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "proposalRef",
    "rowRef",
    "templateId",
    "requiredIndependentValidation",
  ],
  properties: {
    proposalRef: {
      type: "string",
      maxLength: PROPOSE_GAP_REMEDIATION_TOOL.maxProposalRefLength,
    },
    rowRef: { type: "string", pattern: STABLE_ROW_REF },
    templateId: {
      type: "string",
      enum: Object.values(GAP_REMEDIATION_TEMPLATE_IDS),
    },
    requiredIndependentValidation: { type: "boolean" },
  },
} as const;

export type ProposeGapRemediationInput = {
  rowRef: string;
  templateId: GapRemediationTemplateId;
};

export type ProposeGapRemediationResponse = {
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
    code: GapRemediationLimitationCode;
    affectedScopeRef: string | null;
    reason: string;
    retryable: boolean;
  }>;
  result: {
    proposalRef: string;
    rowRef: string;
    templateId: GapRemediationTemplateId;
    requiredIndependentValidation: boolean;
  };
};
