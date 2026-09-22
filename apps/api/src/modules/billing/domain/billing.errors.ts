export class BillingDomainError extends Error {}
export class InvalidBillingInputError extends BillingDomainError {}
export class BillingOrderNotFoundError extends BillingDomainError {}
export class InsufficientCreditError extends BillingDomainError {}
export class OwnershipMismatchError extends BillingDomainError {}
export class BillingIdempotencyConflictError extends BillingDomainError {}
export class InvalidReservationTransitionError extends BillingDomainError {}
export class BillingConcurrencyError extends BillingDomainError {}
/**
 * Raised when provider spend cannot be priced because the operator has not
 * provisioned an applicable pricing snapshot. This is a server-side
 * provisioning gap, never a malformed caller request.
 */
export class PricingSnapshotUnavailableError extends BillingDomainError {}
