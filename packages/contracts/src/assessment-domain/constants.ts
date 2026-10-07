/** W3 assessment-domain value sets. Closed vocabularies, `as const` objects only (no TS enums
 * or hand-written literal unions). Canonical values are SCREAMING_SNAKE_CASE.
 *
 * The AssessmentCase/Evidence/Request/Decision rows are the single authoritative domain state;
 * nothing here makes a semantic legal/compliance judgment. Every semantic choice belongs to the
 * Assessment Root agent; these values only describe accepted records and mechanical failures.
 */

/** Accepted evidence kinds. SEARCH_COVERAGE is a subtype of the one evidence ledger. */
export const ASSESSMENT_EVIDENCE_TYPES = {
  REPOSITORY_SOURCE: "REPOSITORY_SOURCE",
  SEARCH_COVERAGE: "SEARCH_COVERAGE",
} as const;
export type AssessmentEvidenceType =
  (typeof ASSESSMENT_EVIDENCE_TYPES)[keyof typeof ASSESSMENT_EVIDENCE_TYPES];

/** Evidence/fact record state. INVALIDATED is terminal and cascades to dependent decisions. */
export const ASSESSMENT_RECORD_STATES = {
  ACCEPTED: "ACCEPTED",
  INVALIDATED: "INVALIDATED",
} as const;
export type AssessmentRecordState =
  (typeof ASSESSMENT_RECORD_STATES)[keyof typeof ASSESSMENT_RECORD_STATES];

/** Accepted case records: a plain fact or the use-case description of the assessed system. */
export const ASSESSMENT_FACT_KINDS = {
  FACT: "FACT",
  USE_CASE: "USE_CASE",
} as const;
export type AssessmentFactKind =
  (typeof ASSESSMENT_FACT_KINDS)[keyof typeof ASSESSMENT_FACT_KINDS];

/** Who owns the authority of a fact. HUMAN_PROVIDED facts are written only by the human
 * resolution API (W4); the Root can only propose EVIDENCE_CITED facts. */
export const ASSESSMENT_FACT_AUTHORITIES = {
  EVIDENCE_CITED: "EVIDENCE_CITED",
  HUMAN_PROVIDED: "HUMAN_PROVIDED",
} as const;
export type AssessmentFactAuthority =
  (typeof ASSESSMENT_FACT_AUTHORITIES)[keyof typeof ASSESSMENT_FACT_AUTHORITIES];

/** A decision row is accepted exactly once; later decisions supersede it in history. */
export const ASSESSMENT_DECISION_RECORD_STATES = {
  ACCEPTED: "ACCEPTED",
  SUPERSEDED: "SUPERSEDED",
  INVALIDATED: "INVALIDATED",
} as const;
export type AssessmentDecisionRecordState =
  (typeof ASSESSMENT_DECISION_RECORD_STATES)[keyof typeof ASSESSMENT_DECISION_RECORD_STATES];

/** Search scope kinds a coverage record may declare. */
export const SEARCH_COVERAGE_SCOPE_KINDS = {
  SOURCE_DIRECTORY: "SOURCE_DIRECTORY",
  SOURCE_FILE: "SOURCE_FILE",
  GRAPH_INDEX: "GRAPH_INDEX",
} as const;
export type SearchCoverageScopeKind =
  (typeof SEARCH_COVERAGE_SCOPE_KINDS)[keyof typeof SEARCH_COVERAGE_SCOPE_KINDS];

/** The single decision scope of an assessment. Multi-scope decisions are a later extension. */
export const ASSESSMENT_DECISION_SCOPE = "ASSESSMENT" as const;

/** Mechanical DecisionValidator failures. These reject a packet's identity/structure only;
 * they never re-evaluate what the Root decided. */
export const DECISION_VALIDATION_FAILURE_CODES = {
  UNKNOWN_ENGINEERING_RULE: "UNKNOWN_ENGINEERING_RULE",
  ENGINEERING_RULE_VERSION_MISMATCH: "ENGINEERING_RULE_VERSION_MISMATCH",
  PORTFOLIO_PIN_MISMATCH: "PORTFOLIO_PIN_MISMATCH",
  REPOSITORY_PIN_MISMATCH: "REPOSITORY_PIN_MISMATCH",
  CASE_REVISION_STALE: "CASE_REVISION_STALE",
  UNKNOWN_SCOPE: "UNKNOWN_SCOPE",
  UNKNOWN_LEGAL_CONTEXT: "UNKNOWN_LEGAL_CONTEXT",
  CRITERIA_INCOMPLETE: "CRITERIA_INCOMPLETE",
  UNKNOWN_CRITERION: "UNKNOWN_CRITERION",
  UNKNOWN_EVIDENCE_REFERENCE: "UNKNOWN_EVIDENCE_REFERENCE",
  EVIDENCE_NOT_ACCEPTED: "EVIDENCE_NOT_ACCEPTED",
  EVIDENCE_PIN_MISMATCH: "EVIDENCE_PIN_MISMATCH",
  UNKNOWN_FACT_REFERENCE: "UNKNOWN_FACT_REFERENCE",
  FACT_NOT_ACCEPTED: "FACT_NOT_ACCEPTED",
  FACT_REVISION_MISMATCH: "FACT_REVISION_MISMATCH",
} as const;
export type DecisionValidationFailureCode =
  (typeof DECISION_VALIDATION_FAILURE_CODES)[keyof typeof DECISION_VALIDATION_FAILURE_CODES];

/** Problem-envelope codes of the assessment-domain API. */
export const ASSESSMENT_DOMAIN_ERROR_CODES = {
  RUNTIME_NOT_FOUND: "ASSESSMENT_RUNTIME_NOT_FOUND",
  THREAD_MISMATCH: "ASSESSMENT_THREAD_MISMATCH",
  EXECUTION_LEASE_INVALID: "ASSESSMENT_EXECUTION_LEASE_INVALID",
  EXECUTION_LEASE_HELD: "ASSESSMENT_EXECUTION_LEASE_HELD",
  NOT_ACTIVE: "ASSESSMENT_NOT_ACTIVE",
  PINS_NOT_READY: "ASSESSMENT_PINS_NOT_READY",
  REQUEST_INVALID: "ASSESSMENT_DOMAIN_REQUEST_INVALID",
  CASE_REVISION_STALE: "ASSESSMENT_CASE_REVISION_STALE",
  DECISION_REVISION_STALE: "ASSESSMENT_DECISION_REVISION_STALE",
  EVIDENCE_PIN_MISMATCH: "ASSESSMENT_EVIDENCE_PIN_MISMATCH",
  EVIDENCE_REFERENCE_INVALID: "ASSESSMENT_EVIDENCE_REFERENCE_INVALID",
  DECISION_VALIDATION_FAILED: "ASSESSMENT_DECISION_VALIDATION_FAILED",
  RULE_NOT_IN_PORTFOLIO: "ASSESSMENT_RULE_NOT_IN_PORTFOLIO",
  IDEMPOTENCY_CONFLICT: "ASSESSMENT_IDEMPOTENCY_CONFLICT",
  HUMAN_REQUEST_INVALID: "ASSESSMENT_HUMAN_REQUEST_INVALID",
} as const;
export type AssessmentDomainErrorCode =
  (typeof ASSESSMENT_DOMAIN_ERROR_CODES)[keyof typeof ASSESSMENT_DOMAIN_ERROR_CODES];

/** Outbox/queue command that starts (or resumes) the one Root run of an assessment. */
export const ASSESSMENT_ROOT_COMMAND_TYPES = {
  ROOT_REQUESTED: "command.assessment.root.requested.v1",
} as const;
export type AssessmentRootCommandType =
  (typeof ASSESSMENT_ROOT_COMMAND_TYPES)[keyof typeof ASSESSMENT_ROOT_COMMAND_TYPES];

/** Customer-safe activity label keys written by the domain boundary. */
export const ASSESSMENT_DOMAIN_ACTIVITY_LABEL_KEYS = {
  FACT_ACCEPTED: "assessment.activity.factAccepted",
  RULE_INVESTIGATION_STARTED: "assessment.activity.ruleInvestigationStarted",
  ROOT_STARTED: "assessment.activity.rootStarted",
  TASK_STARTED: "assessment.activity.taskStarted",
  TASK_FINISHED: "assessment.activity.taskFinished",
} as const;
export type AssessmentDomainActivityLabelKey =
  (typeof ASSESSMENT_DOMAIN_ACTIVITY_LABEL_KEYS)[keyof typeof ASSESSMENT_DOMAIN_ACTIVITY_LABEL_KEYS];

export const ASSESSMENT_DOMAIN_LIMITS = {
  LEASE_SECONDS: 600,
  MAX_PATH_LENGTH: 1024,
  MAX_LINE_SPAN: 2000,
  MAX_COVERAGE_ITEMS: 200,
  MAX_EVIDENCE_REFERENCES: 100,
  MAX_STATEMENT_LENGTH: 10000,
} as const;

/** Audit event names for authority-bearing domain writes. */
export const ASSESSMENT_DOMAIN_AUDIT_EVENT_TYPES = {
  RUNTIME_ACTIVATED: "ASSESSMENT_RUNTIME_ACTIVATED",
  RULE_DECISION_ACCEPTED: "ASSESSMENT_RULE_DECISION_ACCEPTED",
  HUMAN_REQUEST_OPENED: "ASSESSMENT_HUMAN_REQUEST_OPENED",
} as const;
export type AssessmentDomainAuditEventType =
  (typeof ASSESSMENT_DOMAIN_AUDIT_EVENT_TYPES)[keyof typeof ASSESSMENT_DOMAIN_AUDIT_EVENT_TYPES];
