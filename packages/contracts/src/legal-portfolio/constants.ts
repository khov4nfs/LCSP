/**
 * Legal portfolio contract value sets (W2).
 *
 * One Legal Preparation Deep Agent authors the complete LegalRule +
 * EngineeringRule portfolio for one pinned immutable corpus. The server
 * validates mechanical integrity only (identity, hash, citation, locator,
 * provenance, shape, completeness) and never judges legal meaning.
 *
 * Portfolio lifecycle reuses ARTIFACT_LIFECYCLE_STATES and preparation
 * execution reuses AGENT_EXECUTION_STATES from the assessment runtime
 * contract. No approval, signoff or draft values exist here.
 */

export const LEGAL_PORTFOLIO_COVERAGE_STATES = {
  COVERED_BY_ENGINEERING_RULES: "COVERED_BY_ENGINEERING_RULES",
  NON_ASSESSABLE: "NON_ASSESSABLE",
} as const;
export type LegalPortfolioCoverageState =
  (typeof LEGAL_PORTFOLIO_COVERAGE_STATES)[keyof typeof LEGAL_PORTFOLIO_COVERAGE_STATES];

export const LEGAL_CONTEXT_RELATION_KINDS = {
  DEFINITION: "DEFINITION",
  SCOPE: "SCOPE",
  QUALIFIER: "QUALIFIER",
  EXCEPTION: "EXCEPTION",
  CROSS_REFERENCE: "CROSS_REFERENCE",
} as const;
export type LegalContextRelationKind =
  (typeof LEGAL_CONTEXT_RELATION_KINDS)[keyof typeof LEGAL_CONTEXT_RELATION_KINDS];

export const ENGINEERING_GRAPH_QUERY_DIRECTIONS = {
  FORWARD: "FORWARD",
  BACKWARD: "BACKWARD",
  BOTH: "BOTH",
} as const;
export type EngineeringGraphQueryDirection =
  (typeof ENGINEERING_GRAPH_QUERY_DIRECTIONS)[keyof typeof ENGINEERING_GRAPH_QUERY_DIRECTIONS];

/** Mechanical validation outcome. Not a lifecycle family. */
export const LEGAL_PORTFOLIO_VALIDATION_OUTCOMES = {
  PASSED: "PASSED",
  FAILED: "FAILED",
} as const;
export type LegalPortfolioValidationOutcome =
  (typeof LEGAL_PORTFOLIO_VALIDATION_OUTCOMES)[keyof typeof LEGAL_PORTFOLIO_VALIDATION_OUTCOMES];

/** Structured mechanical failure codes attached to an INVALID candidate. */
export const LEGAL_PORTFOLIO_FAILURE_CODES = {
  CORPUS_NOT_FOUND: "CORPUS_NOT_FOUND",
  RETRIEVAL_INDEX_NOT_VALID: "RETRIEVAL_INDEX_NOT_VALID",
  EMPTY_PORTFOLIO: "EMPTY_PORTFOLIO",
  UNRESOLVED_SOURCE_REFERENCE: "UNRESOLVED_SOURCE_REFERENCE",
  STALE_SOURCE_HASH: "STALE_SOURCE_HASH",
  REPEALED_SOURCE_REFERENCE: "REPEALED_SOURCE_REFERENCE",
  MIXED_CORPUS_VERSION: "MIXED_CORPUS_VERSION",
  DUPLICATE_RULE_ID: "DUPLICATE_RULE_ID",
  DUPLICATE_ENGINEERING_RULE_ID: "DUPLICATE_ENGINEERING_RULE_ID",
  ORPHAN_ENGINEERING_RULE: "ORPHAN_ENGINEERING_RULE",
  ORPHAN_CONTEXT_RELATION: "ORPHAN_CONTEXT_RELATION",
  INCOMPLETE_SOURCE_COVERAGE: "INCOMPLETE_SOURCE_COVERAGE",
  INCOMPLETE_RULE_COVERAGE: "INCOMPLETE_RULE_COVERAGE",
  NON_ASSESSABLE_REASON_REQUIRED: "NON_ASSESSABLE_REASON_REQUIRED",
} as const;
export type LegalPortfolioFailureCode =
  (typeof LEGAL_PORTFOLIO_FAILURE_CODES)[keyof typeof LEGAL_PORTFOLIO_FAILURE_CODES];

/** Why a Legal Preparation execution failed before producing an activated portfolio. */
export const LEGAL_PREPARATION_FAILURE_REASONS = {
  MODEL_ERROR: "MODEL_ERROR",
  NO_SUBMISSION: "NO_SUBMISSION",
  PORTFOLIO_VALIDATION_FAILED: "PORTFOLIO_VALIDATION_FAILED",
  CORPUS_UNAVAILABLE: "CORPUS_UNAVAILABLE",
  RUNTIME_ERROR: "RUNTIME_ERROR",
} as const;
export type LegalPreparationFailureReason =
  (typeof LEGAL_PREPARATION_FAILURE_REASONS)[keyof typeof LEGAL_PREPARATION_FAILURE_REASONS];

/** Problem-envelope codes for the portfolio API (not validation outcomes). */
export const LEGAL_PORTFOLIO_ERROR_CODES = {
  submitRequestInvalid: "LEGAL_PORTFOLIO_SUBMIT_REQUEST_INVALID",
  preparationRunNotFound: "LEGAL_PREPARATION_RUN_NOT_FOUND",
  preparationRunConflict: "LEGAL_PREPARATION_RUN_CONFLICT",
  idempotencyConflict: "LEGAL_PORTFOLIO_IDEMPOTENCY_CONFLICT",
  portfolioNotFound: "LEGAL_PORTFOLIO_NOT_FOUND",
  activePortfolioNotFound: "ACTIVE_LEGAL_PORTFOLIO_NOT_FOUND",
} as const;

export const LEGAL_PORTFOLIO_EVENT_TYPES = {
  preparationRequested: "command.legal-portfolio.preparation.requested.v1",
  portfolioActivated: "event.legal-portfolio.activated.v1",
  portfolioValidationFailed: "event.legal-portfolio.validation-failed.v1",
} as const;

/** Trust-boundary size limits (DoS protection on the worker submit route). */
export const LEGAL_PORTFOLIO_LIMITS = {
  maxLegalRules: 5000,
  maxEngineeringRules: 20000,
  maxContextRelations: 20000,
  maxSourceRefsPerRule: 64,
  maxListItems: 64,
  maxIdLength: 128,
  maxShortTextLength: 512,
  maxTextLength: 8000,
} as const;
