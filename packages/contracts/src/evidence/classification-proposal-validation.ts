import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "./agentic-tool.ts";

export const CLASSIFICATION_PROPOSAL_VERDICTS = {
  pass: "PASS",
  fail: "FAIL",
} as const;

export type ClassificationProposalVerdict =
  (typeof CLASSIFICATION_PROPOSAL_VERDICTS)[keyof typeof CLASSIFICATION_PROPOSAL_VERDICTS];

export const CLASSIFICATION_PROPOSAL_NEXT_STATES = {
  readyForIndependentReview: "PROPOSAL_READY_FOR_INDEPENDENT_REVIEW",
} as const;

export type ClassificationProposalNextState =
  (typeof CLASSIFICATION_PROPOSAL_NEXT_STATES)[keyof typeof CLASSIFICATION_PROPOSAL_NEXT_STATES];

export const CLASSIFICATION_PROPOSAL_VIOLATION_CODES = {
  labelNotEligible: "CLASSIFICATION_LABEL_NOT_ELIGIBLE",
  citationOutOfAllowlist: "CLASSIFICATION_CITATION_OUT_OF_ALLOWLIST",
  citationCoverageLimited: "CLASSIFICATION_CITATION_COVERAGE_LIMITED",
  baselineUnavailable: "CLASSIFICATION_BASELINE_UNAVAILABLE",
  guardrailBlocked: "CLASSIFICATION_GUARDRAIL_BLOCKED",
  resultAlreadyExists: "CLASSIFICATION_RESULT_ALREADY_EXISTS",
} as const;

export type ClassificationProposalViolationCode =
  (typeof CLASSIFICATION_PROPOSAL_VIOLATION_CODES)[keyof typeof CLASSIFICATION_PROPOSAL_VIOLATION_CODES];

export const VALIDATE_CLASSIFICATION_PROPOSAL_TOOL = {
  name: "validate_classification_proposal",
  version: "1.0.0",
  configHash: "sha256:classification-gate-v1",
  maxCitationRefs: 20,
  maxViolations: 20,
} as const;

const STABLE_BASELINE_REF = "^baseline:[A-Za-z0-9_-]{6,80}$";
const STABLE_PROPOSAL_GATE_REF =
  "^classification-gate:[A-Za-z0-9_-]{8,120}$";
const STABLE_LABEL = "^CLASSIFICATION_[A-Z0-9_]{3,64}$";
const STABLE_CITATION_REF = "^citation:chunk_[A-Za-z0-9_-]{6,80}$";

export const VALIDATE_CLASSIFICATION_PROPOSAL_INPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["baselineRef", "candidateLabel", "citationRefs"],
  properties: {
    baselineRef: { type: "string", pattern: STABLE_BASELINE_REF },
    candidateLabel: { type: "string", pattern: STABLE_LABEL },
    citationRefs: {
      type: "array",
      minItems: 1,
      maxItems: VALIDATE_CLASSIFICATION_PROPOSAL_TOOL.maxCitationRefs,
      uniqueItems: true,
      items: { type: "string", pattern: STABLE_CITATION_REF },
    },
  },
} as const;

export const VALIDATE_CLASSIFICATION_PROPOSAL_RESULT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["proposalGateRef", "verdict", "violations", "allowedNextState"],
  properties: {
    proposalGateRef: { type: "string", pattern: STABLE_PROPOSAL_GATE_REF },
    verdict: { enum: Object.values(CLASSIFICATION_PROPOSAL_VERDICTS) },
    violations: {
      type: "array",
      maxItems: VALIDATE_CLASSIFICATION_PROPOSAL_TOOL.maxViolations,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code", "ref"],
        properties: {
          code: {
            enum: Object.values(CLASSIFICATION_PROPOSAL_VIOLATION_CODES),
          },
          ref: { type: ["string", "null"], maxLength: 128 },
        },
      },
    },
    allowedNextState: {
      type: ["string", "null"],
      enum: [
        ...Object.values(CLASSIFICATION_PROPOSAL_NEXT_STATES),
        null,
      ],
    },
  },
} as const;

export type ValidateClassificationProposalInput = {
  baselineRef: string;
  candidateLabel: string;
  citationRefs: string[];
};

export type ValidateClassificationProposalResponse = {
  status: AgenticToolStatus;
  toolName: AgenticToolName;
  toolVersion: string;
  configHash: string;
  correlationId: string;
  artifactVersions: { baselineRef: string };
  provenanceRef: string;
  coverageState: AgenticToolCoverageState;
  evidenceRefs: string[];
  limitations: Array<{
    code: ClassificationProposalViolationCode;
    affectedScopeRef: string | null;
    reason: string;
    retryable: boolean;
  }>;
  result: {
    proposalGateRef: string;
    verdict: ClassificationProposalVerdict;
    violations: Array<{
      code: ClassificationProposalViolationCode;
      ref: string | null;
    }>;
    allowedNextState: ClassificationProposalNextState | null;
  };
};
