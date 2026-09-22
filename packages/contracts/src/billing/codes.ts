export const BILLING_ERROR_CODES = {
  validationFailed: "BILLING_VALIDATION_FAILED",
  idempotencyKeyRequired: "BILLING_IDEMPOTENCY_KEY_REQUIRED",
  idempotencyConflict: "BILLING_IDEMPOTENCY_CONFLICT",
  notFound: "BILLING_NOT_FOUND",
  insufficientCredits: "BILLING_INSUFFICIENT_CREDITS",
  ownershipMismatch: "BILLING_OWNERSHIP_MISMATCH",
  reservationTransition: "BILLING_RESERVATION_TRANSITION_INVALID",
  usageUnavailable: "BILLING_USAGE_UNAVAILABLE",
  pricingUnavailable: "BILLING_PRICING_UNAVAILABLE",
  concurrencyConflict: "BILLING_CONCURRENCY_CONFLICT",
} as const;

export type BillingErrorCode =
  (typeof BILLING_ERROR_CODES)[keyof typeof BILLING_ERROR_CODES];
