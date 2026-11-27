/**
 * Canonical billing and WP8 model pricing domain error codes shared across NestJS API and Next.js BFF.
 * Why: Centralizes stable SCREAMING_SNAKE_CASE error identifiers for RFC 7807 Problem Details mapping.
 * How: Defined as a frozen `as const` lookup object with a derived union type (never TypeScript `enum`).
 * Invariants: Existing payment/usage codes remain unchanged; Phase B2 adds `MODEL_PRICING_*` codes.
 */
export const BILLING_ERROR_CODES = {
  validationFailed: "BILLING_VALIDATION_FAILED",
  idempotencyKeyRequired: "BILLING_IDEMPOTENCY_KEY_REQUIRED",
  idempotencyConflict: "BILLING_IDEMPOTENCY_CONFLICT",
  notFound: "BILLING_NOT_FOUND",
  ownershipMismatch: "BILLING_OWNERSHIP_MISMATCH",
  reservationTransition: "BILLING_RESERVATION_TRANSITION_INVALID",
  concurrencyConflict: "BILLING_CONCURRENCY_CONFLICT",
  paymentRequired: "BILLING_PAYMENT_REQUIRED",
  walletConcurrencyLimitExceeded: "BILLING_WALLET_CONCURRENCY_LIMIT_EXCEEDED",
  admissionNotFound: "BILLING_ADMISSION_NOT_FOUND",
  admissionExpired: "BILLING_ADMISSION_EXPIRED",
  admissionInvalidState: "BILLING_ADMISSION_INVALID_STATE",
  admissionAlreadyInFlight: "BILLING_ADMISSION_ALREADY_IN_FLIGHT",
  admissionCapabilityMismatch: "BILLING_ADMISSION_CAPABILITY_MISMATCH",
  admissionContextMismatch: "BILLING_ADMISSION_CONTEXT_MISMATCH",
  providerCorrelationUnsupported: "BILLING_PROVIDER_CORRELATION_UNSUPPORTED",
  incompleteReconciliationWindow: "BILLING_INCOMPLETE_RECONCILIATION_WINDOW",
  invalidReconciliationEvidence: "BILLING_INVALID_RECONCILIATION_EVIDENCE",
  admissionAlreadySettled: "BILLING_ADMISSION_ALREADY_SETTLED",
  reconciliationAlreadyResolved: "BILLING_RECONCILIATION_ALREADY_RESOLVED",
  modelPricingNotFound: "MODEL_PRICING_NOT_FOUND",
  modelPricingOverlapConflict: "MODEL_PRICING_OVERLAP_CONFLICT",
  modelPricingImmutableSnapshot: "MODEL_PRICING_IMMUTABLE_SNAPSHOT",
  modelPricingUnlistedModel: "MODEL_PRICING_UNLISTED_MODEL",
  modelPricingIncompleteRates: "MODEL_PRICING_INCOMPLETE_RATES",
  modelPricingStaleDraft: "MODEL_PRICING_STALE_DRAFT",
  modelPricingInvalidInterval: "MODEL_PRICING_INVALID_INTERVAL",
  modelPricingNoCoverage: "MODEL_PRICING_NO_COVERAGE",
  modelPricingInvalidState: "MODEL_PRICING_INVALID_STATE",
  // G-07 Transaction Compensation & Debit Linking error codes (ADR-028 Line 159 & Line 173)
  debitNotFound: "BILLING_DEBIT_NOT_FOUND",
  debitNotEligible: "BILLING_DEBIT_NOT_ELIGIBLE",
  compensationLimitExceeded: "BILLING_COMPENSATION_LIMIT_EXCEEDED",
  compensationAmountInvalid: "BILLING_COMPENSATION_AMOUNT_INVALID",
} as const;

export type BillingErrorCode =
  (typeof BILLING_ERROR_CODES)[keyof typeof BILLING_ERROR_CODES];
