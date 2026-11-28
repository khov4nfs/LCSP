import {
  BILLING_ERROR_CODES,
  type BillingErrorCode,
} from "@lcsp/contracts/billing";

export class BillingDomainError extends Error {}
export class InvalidBillingInputError extends BillingDomainError {}
export class BillingOrderNotFoundError extends BillingDomainError {}
export class InsufficientCreditError extends BillingDomainError {}
export class OwnershipMismatchError extends BillingDomainError {}
export class BillingIdempotencyConflictError extends BillingDomainError {}
export class InvalidReservationTransitionError extends BillingDomainError {}
export class BillingConcurrencyError extends BillingDomainError {}

/**
 * Base domain error for WP8 Phase B2 model pricing governance, allowlist, and calculation failures.
 * Why: Carries a canonical `BILLING_ERROR_CODES` member so presentation error mappers translate domain
 * rejections deterministically into RFC 7807 Problem Details without string-matching error messages.
 * How: Extends `BillingDomainError` with an immutable `code: BillingErrorCode` property.
 * Invariants: Every subclass binds a canonical `MODEL_PRICING_*` constant from `@lcsp/contracts/billing`.
 */
export class ModelPricingDomainError extends BillingDomainError {
  constructor(
    readonly code: BillingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ModelPricingUnlistedModelError extends ModelPricingDomainError {
  constructor(message: string) {
    super(BILLING_ERROR_CODES.modelPricingUnlistedModel, message);
  }
}

export class ModelPricingNoCoverageError extends ModelPricingDomainError {
  constructor(message: string) {
    super(BILLING_ERROR_CODES.modelPricingNoCoverage, message);
  }
}

export class ModelPricingIncompleteRatesError extends ModelPricingDomainError {
  constructor(message: string) {
    super(BILLING_ERROR_CODES.modelPricingIncompleteRates, message);
  }
}

export class ModelPricingInvalidIntervalError extends ModelPricingDomainError {
  constructor(message: string) {
    super(BILLING_ERROR_CODES.modelPricingInvalidInterval, message);
  }
}

export class ModelPricingNotFoundError extends ModelPricingDomainError {
  constructor(message: string) {
    super(BILLING_ERROR_CODES.modelPricingNotFound, message);
  }
}

export class ModelPricingOverlapConflictError extends ModelPricingDomainError {
  constructor(message: string) {
    super(BILLING_ERROR_CODES.modelPricingOverlapConflict, message);
  }
}

export class ModelPricingImmutableSnapshotError extends ModelPricingDomainError {
  constructor(message: string) {
    super(BILLING_ERROR_CODES.modelPricingImmutableSnapshot, message);
  }
}

export class ModelPricingStaleDraftError extends ModelPricingDomainError {
  constructor(message: string) {
    super(BILLING_ERROR_CODES.modelPricingStaleDraft, message);
  }
}

export class ModelPricingInvalidStateError extends ModelPricingDomainError {
  constructor(message: string) {
    super(BILLING_ERROR_CODES.modelPricingInvalidState, message);
  }
}
