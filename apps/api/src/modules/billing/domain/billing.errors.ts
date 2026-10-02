export class BillingDomainError extends Error {}
export class InvalidBillingInputError extends BillingDomainError {}
export class BillingOrderNotFoundError extends BillingDomainError {}
export class InsufficientCreditError extends BillingDomainError {}
export class OwnershipMismatchError extends BillingDomainError {}
export class BillingIdempotencyConflictError extends BillingDomainError {}
export class InvalidReservationTransitionError extends BillingDomainError {}
export class BillingConcurrencyError extends BillingDomainError {}
