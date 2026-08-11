import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "./agentic-tool.ts";

export const CLASSIFICATION_REVIEW_SUBMISSION_TOOL = {
  name: "submit_classification_for_independent_review",
  version: "1.0.0",
  configHash: "sha256:classification-review-request-v1",
  maxCitationRefs: 20,
  expiresInDays: 8,
} as const;

export const CLASSIFICATION_REVIEW_REQUEST_STATUSES = {
  pendingIndependentReview: "PENDING_INDEPENDENT_REVIEW",
} as const;

export type ClassificationReviewRequestStatus =
  (typeof CLASSIFICATION_REVIEW_REQUEST_STATUSES)[keyof typeof CLASSIFICATION_REVIEW_REQUEST_STATUSES];

export const CLASSIFICATION_REVIEW_REQUIRED_ACTIONS = {
  approveOrReject: "APPROVE_OR_REJECT",
} as const;

export type ClassificationReviewRequiredAction =
  (typeof CLASSIFICATION_REVIEW_REQUIRED_ACTIONS)[keyof typeof CLASSIFICATION_REVIEW_REQUIRED_ACTIONS];

export const CLASSIFICATION_REVIEW_SUBMISSION_LIMITATION_CODES = {
  gateUnavailable: "CLASSIFICATION_GATE_UNAVAILABLE",
  gateFailed: "CLASSIFICATION_GATE_FAILED",
  gatePayloadMismatch: "CLASSIFICATION_GATE_PAYLOAD_MISMATCH",
  citationCoverageLimited: "CLASSIFICATION_CITATION_COVERAGE_LIMITED",
  conflictOpen: "CLASSIFICATION_CONFLICT_OPEN",
  resultAlreadyExists: "CLASSIFICATION_RESULT_ALREADY_EXISTS",
} as const;

export type ClassificationReviewSubmissionLimitationCode =
  (typeof CLASSIFICATION_REVIEW_SUBMISSION_LIMITATION_CODES)[keyof typeof CLASSIFICATION_REVIEW_SUBMISSION_LIMITATION_CODES];

const STABLE_PROPOSAL_GATE_REF =
  "^classification-gate:[A-Za-z0-9_-]{8,120}$";
const STABLE_BASELINE_REF = "^baseline:[A-Za-z0-9_-]{6,80}$";
const STABLE_LABEL = "^CLASSIFICATION_[A-Z0-9_]{3,64}$";
const STABLE_CITATION_REF = "^citation:chunk_[A-Za-z0-9_-]{6,80}$";

export const SUBMIT_CLASSIFICATION_REVIEW_INPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "proposalGateRef",
    "baselineRef",
    "candidateLabel",
    "citationRefs",
    "idempotencyKey",
  ],
  properties: {
    proposalGateRef: { type: "string", pattern: STABLE_PROPOSAL_GATE_REF },
    baselineRef: { type: "string", pattern: STABLE_BASELINE_REF },
    candidateLabel: { type: "string", pattern: STABLE_LABEL },
    citationRefs: {
      type: "array",
      minItems: 1,
      maxItems: CLASSIFICATION_REVIEW_SUBMISSION_TOOL.maxCitationRefs,
      uniqueItems: true,
      items: { type: "string", pattern: STABLE_CITATION_REF },
    },
    idempotencyKey: { type: "string", format: "uuid" },
  },
} as const;

export type SubmitClassificationReviewInput = {
  proposalGateRef: string;
  baselineRef: string;
  candidateLabel: string;
  citationRefs: string[];
  idempotencyKey: string;
};

export type SubmitClassificationReviewResponse = {
  status: AgenticToolStatus;
  toolName: AgenticToolName;
  toolVersion: string;
  configHash: string;
  correlationId: string;
  artifactVersions: {
    baselineRef: string;
    proposalGateRef: string;
  };
  provenanceRef: string;
  coverageState: AgenticToolCoverageState;
  evidenceRefs: string[];
  limitations: Array<{
    code: ClassificationReviewSubmissionLimitationCode;
    affectedScopeRef: string | null;
    reason: string;
    retryable: boolean;
  }>;
  result: {
    reviewRequestRef: string | null;
    status: ClassificationReviewRequestStatus | null;
    proposalGateRef: string;
    requiredReviewerAction: ClassificationReviewRequiredAction | null;
    expiresAt: string | null;
  };
};
