import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "./agentic-tool.ts";

export const GAP_REQUIREMENT_LIMITATION_CODES = {
  classificationUnavailable: "GAP_REQUIREMENTS_CLASSIFICATION_UNAVAILABLE",
  classificationBlocked: "GAP_REQUIREMENTS_CLASSIFICATION_BLOCKED",
  policyUnavailable: "GAP_REQUIREMENTS_POLICY_UNAVAILABLE",
  requirementsUnavailable: "GAP_REQUIREMENTS_UNAVAILABLE",
} as const;

export type GapRequirementLimitationCode =
  (typeof GAP_REQUIREMENT_LIMITATION_CODES)[keyof typeof GAP_REQUIREMENT_LIMITATION_CODES];

export const GET_GAP_REQUIREMENTS_TOOL = {
  name: "get_gap_requirements",
  version: "1.0.0",
  configHash: "sha256:gap-requirements-v1",
  maxRequirements: 100,
} as const;

const STABLE_CLASSIFICATION_REF = "^classification:[A-Za-z0-9_-]{6,80}$";
const STABLE_POLICY_REF = "^policy_[A-Za-z0-9_-]{8,80}$";
const STABLE_MATRIX_REF = "^matrix:[A-Za-z0-9_-]{6,80}$";

export const GET_GAP_REQUIREMENTS_INPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["classificationRef", "policyProfileVersionId"],
  properties: {
    classificationRef: { type: "string", pattern: STABLE_CLASSIFICATION_REF },
    policyProfileVersionId: { type: "string", pattern: STABLE_POLICY_REF },
  },
} as const;

export const GET_GAP_REQUIREMENTS_RESULT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["matrixRef", "requirements", "nextCursor"],
  properties: {
    matrixRef: { type: ["string", "null"], pattern: STABLE_MATRIX_REF },
    requirements: {
      type: "array",
      maxItems: GET_GAP_REQUIREMENTS_TOOL.maxRequirements,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["requirementId", "locator"],
        properties: {
          requirementId: { type: "string", maxLength: 128 },
          locator: { type: "string", maxLength: 128 },
        },
      },
    },
    nextCursor: { type: "null" },
  },
} as const;

export type GetGapRequirementsInput = {
  classificationRef: string;
  policyProfileVersionId: string;
};

export type GetGapRequirementsResponse = {
  status: AgenticToolStatus;
  toolName: AgenticToolName;
  toolVersion: string;
  configHash: string;
  correlationId: string;
  artifactVersions: {
    classificationRef: string;
    policyProfileVersionId: string;
  };
  provenanceRef: string;
  coverageState: AgenticToolCoverageState;
  evidenceRefs: string[];
  limitations: Array<{
    code: GapRequirementLimitationCode;
    affectedScopeRef: string | null;
    reason: string;
    retryable: boolean;
  }>;
  result: {
    matrixRef: string | null;
    requirements: Array<{
      requirementId: string;
      locator: string;
    }>;
    nextCursor: null;
  };
};
