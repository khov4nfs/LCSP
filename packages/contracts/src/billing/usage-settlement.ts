/**
 * Why: WP8 Phase A/A2 introduces direct-credit usage admission, completion/evaluation separation,
 * and a production feature gate (`MODEL_USAGE_DEBIT_MODES`) that starts at `OFF` so schema and
 * accounting boundaries can ship safely before live debit activation.
 * How: Every closed domain value set uses `as const` objects with `SCREAMING_SNAKE_CASE` values
 * and derived union types (no TypeScript `enum` or direct string-literal unions).
 * Invariants: `PROVIDER_COMPLETION_STATES` and `OUTPUT_EVALUATION_STATES` must remain 100%
 * identical to `deepagents/middleware/usage_metering.py`, and `ADMISSION_STATES` must match
 * `docs/specs/domain-state-machines.md`.
 */

/**
 * Operational rollout mode for model-usage microcredit debiting.
 * Defaults to `OFF` in WP8 Phase A/A2 until Phase B+ rollout gates are enabled.
 */
export const MODEL_USAGE_DEBIT_MODES = {
  OFF: "OFF",
  SHADOW: "SHADOW",
  ON: "ON",
} as const;

export type ModelUsageDebitMode =
  (typeof MODEL_USAGE_DEBIT_MODES)[keyof typeof MODEL_USAGE_DEBIT_MODES];

/**
 * Canonical provider-level completion states, kept separate from downstream output quality
 * evaluation (`OUTPUT_EVALUATION_STATES`). Mirrors `deepagents/middleware/usage_metering.py`.
 */
export const PROVIDER_COMPLETION_STATES = {
  COMPLETED: "COMPLETED",
  MAX_TOKENS: "MAX_TOKENS",
  TRUNCATED: "TRUNCATED",
  FAILED: "FAILED",
  OUTCOME_UNKNOWN: "OUTCOME_UNKNOWN",
} as const;

export type ProviderCompletionState =
  (typeof PROVIDER_COMPLETION_STATES)[keyof typeof PROVIDER_COMPLETION_STATES];

/**
 * Canonical downstream output-evaluation states, independent of provider completion status.
 * Mirrors `deepagents/middleware/usage_metering.py`.
 */
export const OUTPUT_EVALUATION_STATES = {
  ACCEPTED: "ACCEPTED",
  SCHEMA_INVALID: "SCHEMA_INVALID",
  DOMAIN_REJECTED: "DOMAIN_REJECTED",
  NOT_EVALUATED: "NOT_EVALUATED",
} as const;

export type OutputEvaluationState =
  (typeof OUTPUT_EVALUATION_STATES)[keyof typeof OUTPUT_EVALUATION_STATES];

/**
 * Canonical ledger entry sources recorded in `CreditLedgerEntry` for prepaid credits,
 * usage settlement debits, compensations, and goodwill adjustments.
 */
export const CREDIT_LEDGER_SOURCES = {
  BILLING_ORDER_CREDIT: "BILLING_ORDER_CREDIT",
  MODEL_USAGE_DEBIT: "MODEL_USAGE_DEBIT",
  COMPENSATION: "COMPENSATION",
  GOODWILL_CREDIT: "GOODWILL_CREDIT",
} as const;

export type CreditLedgerSource =
  (typeof CREDIT_LEDGER_SOURCES)[keyof typeof CREDIT_LEDGER_SOURCES];

/**
 * Funding principal responsible for a `BillableInvocationAdmission`.
 */
export const ADMISSION_FUNDING_PRINCIPALS = {
  CUSTOMER_WALLET: "CUSTOMER_WALLET",
  PLATFORM_SPONSORED: "PLATFORM_SPONSORED",
} as const;

export type AdmissionFundingPrincipal =
  (typeof ADMISSION_FUNDING_PRINCIPALS)[keyof typeof ADMISSION_FUNDING_PRINCIPALS];

/**
 * Canonical lifecycle states for `BillableInvocationAdmission` (`docs/specs/domain-state-machines.md`).
 */
export const ADMISSION_STATES = {
  REQUESTED: "REQUESTED",
  ADMITTED: "ADMITTED",
  REJECTED: "REJECTED",
  IN_FLIGHT: "IN_FLIGHT",
  EXPIRED: "EXPIRED",
  REVOKED: "REVOKED",
  DISPATCH_UNKNOWN: "DISPATCH_UNKNOWN",
  OUTCOME_UNKNOWN: "OUTCOME_UNKNOWN",
  CONFIRMED_NO_USAGE: "CONFIRMED_NO_USAGE",
  SETTLED: "SETTLED",
  BILLING_INTEGRITY_REVIEW: "BILLING_INTEGRITY_REVIEW",
  COMPENSATED: "COMPENSATED",
} as const;

export type AdmissionState =
  (typeof ADMISSION_STATES)[keyof typeof ADMISSION_STATES];
