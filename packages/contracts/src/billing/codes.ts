export const BILLING_ERROR_CODES = {
  validationFailed: "BILLING_VALIDATION_FAILED",
  idempotencyKeyRequired: "BILLING_IDEMPOTENCY_KEY_REQUIRED",
  idempotencyConflict: "BILLING_IDEMPOTENCY_CONFLICT",
  notFound: "BILLING_NOT_FOUND",
} as const;

export type BillingErrorCode =
  (typeof BILLING_ERROR_CODES)[keyof typeof BILLING_ERROR_CODES];
