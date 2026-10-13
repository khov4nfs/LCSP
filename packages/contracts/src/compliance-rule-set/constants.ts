/**
 * Compliance rule set contract value sets (COMPLIANCE_RULE_SET).
 *
 * One Rule Set Preparation Deep Agent authors the complete LegalRequirement +
 * AssessmentRule rule set for one pinned immutable legalSource. The server
 * validates mechanical integrity only (identity, hash, citation, locator,
 * provenance, shape, completeness) and never judges legal meaning.
 *
 * Rule set lifecycle reuses ARTIFACT_LIFECYCLE_STATES and preparation
 * execution reuses AGENT_EXECUTION_STATES from the assessment runtime
 * contract. No approval, signoff or draft values exist here.
 */

export const LEGAL_REQUIREMENT_COVERAGE_STATES = {
  COVERED_BY_ASSESSMENT_RULES: "COVERED_BY_ASSESSMENT_RULES",
  NON_ASSESSABLE: "NON_ASSESSABLE",
} as const;
export type LegalRequirementCoverageState =
  (typeof LEGAL_REQUIREMENT_COVERAGE_STATES)[keyof typeof LEGAL_REQUIREMENT_COVERAGE_STATES];

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
export const COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES = {
  PASSED: "PASSED",
  FAILED: "FAILED",
} as const;
export type ComplianceRuleSetValidationOutcome =
  (typeof COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES)[keyof typeof COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES];

/** Structured mechanical failure codes attached to an INVALID candidate. */
export const COMPLIANCE_RULE_SET_FAILURE_CODES = {
  SOURCE_VERSION_NOT_FOUND: "SOURCE_VERSION_NOT_FOUND",
  RETRIEVAL_INDEX_NOT_VALID: "RETRIEVAL_INDEX_NOT_VALID",
  EMPTY_RULE_SET: "EMPTY_RULE_SET",
  UNRESOLVED_SOURCE_REFERENCE: "UNRESOLVED_SOURCE_REFERENCE",
  STALE_SOURCE_HASH: "STALE_SOURCE_HASH",
  REPEALED_SOURCE_REFERENCE: "REPEALED_SOURCE_REFERENCE",
  MIXED_SOURCE_VERSION: "MIXED_SOURCE_VERSION",
  DUPLICATE_RULE_ID: "DUPLICATE_RULE_ID",
  DUPLICATE_ASSESSMENT_RULE_ID: "DUPLICATE_ASSESSMENT_RULE_ID",
  ORPHAN_ASSESSMENT_RULE: "ORPHAN_ASSESSMENT_RULE",
  ORPHAN_CONTEXT_RELATION: "ORPHAN_CONTEXT_RELATION",
  INCOMPLETE_SOURCE_COVERAGE: "INCOMPLETE_SOURCE_COVERAGE",
  INCOMPLETE_RULE_COVERAGE: "INCOMPLETE_RULE_COVERAGE",
  NON_ASSESSABLE_REASON_REQUIRED: "NON_ASSESSABLE_REASON_REQUIRED",
} as const;
export type ComplianceRuleSetFailureCode =
  (typeof COMPLIANCE_RULE_SET_FAILURE_CODES)[keyof typeof COMPLIANCE_RULE_SET_FAILURE_CODES];

/** Why a Rule Set Preparation execution failed before producing an activated rule set. */
export const RULE_SET_PREPARATION_FAILURE_REASONS = {
  MODEL_ERROR: "MODEL_ERROR",
  NO_SUBMISSION: "NO_SUBMISSION",
  RULE_SET_VALIDATION_FAILED: "RULE_SET_VALIDATION_FAILED",
  SOURCE_VERSION_UNAVAILABLE: "SOURCE_VERSION_UNAVAILABLE",
  RUNTIME_ERROR: "RUNTIME_ERROR",
} as const;
export type RuleSetPreparationFailureReason =
  (typeof RULE_SET_PREPARATION_FAILURE_REASONS)[keyof typeof RULE_SET_PREPARATION_FAILURE_REASONS];

/** Problem-envelope codes for the rule set API (not validation outcomes). */
export const COMPLIANCE_RULE_SET_ERROR_CODES = {
  submitRequestInvalid: "COMPLIANCE_RULE_SET_SUBMIT_REQUEST_INVALID",
  preparationRunNotFound: "RULE_SET_PREPARATION_RUN_NOT_FOUND",
  preparationRunConflict: "RULE_SET_PREPARATION_RUN_CONFLICT",
  idempotencyConflict: "COMPLIANCE_RULE_SET_IDEMPOTENCY_CONFLICT",
  ruleSetNotFound: "COMPLIANCE_RULE_SET_NOT_FOUND",
  activeRuleSetNotFound: "ACTIVE_COMPLIANCE_RULE_SET_NOT_FOUND",
  sourceVersionNotFound: "RULE_SET_PREPARATION_SOURCE_VERSION_NOT_FOUND",
  preparationNotAllowed: "RULE_SET_PREPARATION_NOT_ALLOWED",
} as const;

/** Closed reasons a Rule Set Preparation retry or automatic start is refused. */
export const RULE_SET_PREPARATION_REFUSAL_REASONS = {
  SOURCE_VERSION_NOT_ELIGIBLE: "SOURCE_VERSION_NOT_ELIGIBLE",
  ACTIVE_RULE_SET_EXISTS: "ACTIVE_RULE_SET_EXISTS",
  PREPARATION_IN_PROGRESS: "PREPARATION_IN_PROGRESS",
  SOURCE_VERSION_NOT_ACTIVE: "SOURCE_VERSION_NOT_ACTIVE",
  RUN_NOT_FAILED: "RUN_NOT_FAILED",
  RUN_NOT_LATEST_ATTEMPT: "RUN_NOT_LATEST_ATTEMPT",
} as const;
export type RuleSetPreparationRefusalReason =
  (typeof RULE_SET_PREPARATION_REFUSAL_REASONS)[keyof typeof RULE_SET_PREPARATION_REFUSAL_REASONS];

/**
 * Rule Set Preparation is system-owned: the automatic trigger never impersonates an admin.
 * An operator retry of a failed run is attributed to that operator.
 */
export const RULE_SET_PREPARATION_SYSTEM_ACTOR = "rule-set-preparation-system";

/**
 * A worker that already holds a claim keeps it for this long. A redelivered or duplicated
 * command inside the lease can never start a second paid model run; only a lease that expired
 * without a result (a crashed worker) can be claimed again.
 */
export const RULE_SET_PREPARATION_CLAIM_LEASE_SECONDS = 1800;

/** Durable API-side work queue that turns a Legal Source Version activation into one preparation. */
export const RULE_SET_PREPARATION_QUEUE_NAMES = {
  legalSourceActivated: "lcsp.rule-set-preparation.legalSource-activated.v1",
} as const;

/**
 * Stable identity of the one automatic preparation of a Legal Source Version. It derives from the
 * authoritative source identity only, so event replays and concurrent deliveries collapse into
 * exactly one run.
 */
export function ruleSetPreparationIdempotencyKey(
  legalSourceVersionId: string,
  attempt = 1,
): string {
  return `rule-set-preparation:${legalSourceVersionId}:attempt:${attempt}`;
}

export const COMPLIANCE_RULE_SET_EVENT_TYPES = {
  preparationRequested: "command.compliance-rule-set.preparation.requested.v1",
  ruleSetActivated: "event.compliance-rule-set.activated.v1",
  ruleSetValidationFailed: "event.compliance-rule-set.validation-failed.v1",
} as const;

/** Trust-boundary size limits (DoS protection on the worker submit route). */
export const COMPLIANCE_RULE_SET_LIMITS = {
  maxLegalRequirements: 5000,
  maxAssessmentRules: 20000,
  maxContextRelations: 20000,
  maxSourceRefsPerRule: 64,
  maxListItems: 64,
  maxIdLength: 128,
  maxShortTextLength: 512,
  maxTextLength: 8000,
} as const;
