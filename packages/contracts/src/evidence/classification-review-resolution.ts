import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "./agentic-tool.ts";

export const CLASSIFICATION_REVIEW_RESOLUTION_TOOL = {
  name: "resolve_independent_classification_review",
  version: "1.0.0",
  configHash: "sha256:classification-review-resolve-v1",
} as const;

export const CLASSIFICATION_REVIEW_DECISIONS = {
  approve: "APPROVE",
  reject: "REJECT",
} as const;

export type ClassificationReviewDecision =
  (typeof CLASSIFICATION_REVIEW_DECISIONS)[keyof typeof CLASSIFICATION_REVIEW_DECISIONS];

export const CLASSIFICATION_REVIEW_DECISION_CODES = {
  evidenceSufficient: "EVIDENCE_SUFFICIENT",
  citationsInvalid: "CITATIONS_INVALID",
  conflictUnresolved: "CONFLICT_UNRESOLVED",
  coverageLimited: "COVERAGE_LIMITED",
  policyMismatch: "POLICY_MISMATCH",
} as const;

export type ClassificationReviewDecisionCode =
  (typeof CLASSIFICATION_REVIEW_DECISION_CODES)[keyof typeof CLASSIFICATION_REVIEW_DECISION_CODES];

export const CLASSIFICATION_REVIEW_RESOLUTION_STATUSES = {
  approved: "APPROVED",
  rejected: "REJECTED",
} as const;

export type ClassificationReviewResolutionStatus =
  (typeof CLASSIFICATION_REVIEW_RESOLUTION_STATUSES)[keyof typeof CLASSIFICATION_REVIEW_RESOLUTION_STATUSES];

export const CLASSIFICATION_REVIEW_RESOLUTION_LIMITATION_CODES = {
  reviewRequestUnavailable: "CLASSIFICATION_REVIEW_REQUEST_UNAVAILABLE",
  reviewRequestExpired: "CLASSIFICATION_REVIEW_REQUEST_EXPIRED",
  reviewerNotIndependent: "CLASSIFICATION_REVIEW_REVIEWER_NOT_INDEPENDENT",
  requestAlreadyResolved: "CLASSIFICATION_REVIEW_REQUEST_ALREADY_RESOLVED",
  conflictOpen: "CLASSIFICATION_REVIEW_CONFLICT_OPEN",
  coverageLimited: "CLASSIFICATION_REVIEW_COVERAGE_LIMITED",
  citationInvalid: "CLASSIFICATION_REVIEW_CITATION_INVALID",
  baselineUnavailable: "CLASSIFICATION_REVIEW_BASELINE_UNAVAILABLE",
  resultAlreadyExists: "CLASSIFICATION_RESULT_ALREADY_EXISTS",
} as const;

export type ClassificationReviewResolutionLimitationCode =
  (typeof CLASSIFICATION_REVIEW_RESOLUTION_LIMITATION_CODES)[keyof typeof CLASSIFICATION_REVIEW_RESOLUTION_LIMITATION_CODES];

const STABLE_REVIEW_REQUEST_REF =
  "^classification-review:[A-Za-z0-9_-]{8,120}$";

export const RESOLVE_CLASSIFICATION_REVIEW_INPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "reviewRequestRef",
    "decision",
    "decisionCode",
    "idempotencyKey",
  ],
  properties: {
    reviewRequestRef: { type: "string", pattern: STABLE_REVIEW_REQUEST_REF },
    decision: { enum: Object.values(CLASSIFICATION_REVIEW_DECISIONS) },
    decisionCode: {
      enum: Object.values(CLASSIFICATION_REVIEW_DECISION_CODES),
    },
    idempotencyKey: { type: "string", format: "uuid" },
  },
} as const;

export type ResolveClassificationReviewInput = {
  reviewRequestRef: string;
  decision: ClassificationReviewDecision;
  decisionCode: ClassificationReviewDecisionCode;
  idempotencyKey: string;
};

export type ResolveClassificationReviewResponse = {
  status: AgenticToolStatus;
  toolName: AgenticToolName;
  toolVersion: string;
  configHash: string;
  correlationId: string;
  artifactVersions: {
    reviewRequestRef: string;
  };
  provenanceRef: string;
  coverageState: AgenticToolCoverageState;
  evidenceRefs: string[];
  limitations: Array<{
    code: ClassificationReviewResolutionLimitationCode;
    affectedScopeRef: string | null;
    reason: string;
    retryable: boolean;
  }>;
  result: {
    reviewRequestRef: string;
    reviewStatus: ClassificationReviewResolutionStatus;
    classificationRef: string | null;
    classificationStatus: string | null;
    decisionAuditRef: string;
  };
};
