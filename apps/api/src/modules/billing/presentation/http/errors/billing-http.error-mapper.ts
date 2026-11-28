import { HttpStatus } from "@nestjs/common";
import { BILLING_ERROR_CODES } from "@lcsp/contracts/billing";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import {
  BillingConcurrencyError,
  BillingDomainError,
  BillingIdempotencyConflictError,
  InvalidBillingInputError,
  InvalidReservationTransitionError,
  OwnershipMismatchError,
  BillingOrderNotFoundError,
  ModelPricingImmutableSnapshotError,
  ModelPricingIncompleteRatesError,
  ModelPricingInvalidIntervalError,
  ModelPricingInvalidStateError,
  ModelPricingNoCoverageError,
  ModelPricingNotFoundError,
  ModelPricingOverlapConflictError,
  ModelPricingStaleDraftError,
  ModelPricingUnlistedModelError,
} from "../../../domain/billing.errors.js";
import type { AuthenticatedRequest } from "../../../../../platform/rbac/interfaces/authenticated-request.interface.js";

export function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

export function parseAmount(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value !== "string" && typeof value !== "number")
    throw problemException(
      BILLING_ERROR_CODES.validationFailed,
      "billing-request",
      {
        status: HttpStatus.BAD_REQUEST,
      },
    );
  if (!/^\d+$/.test(String(value)))
    throw problemException(
      BILLING_ERROR_CODES.validationFailed,
      "billing-request",
      {
        status: HttpStatus.BAD_REQUEST,
      },
    );
  return BigInt(String(value));
}

export function mapBillingError(error: unknown, request: AuthenticatedRequest) {
  const correlationId = request.correlationId ?? "billing-request";
  if (
    error instanceof Error &&
    error.message === BILLING_ERROR_CODES.idempotencyKeyRequired
  )
    return problemException(
      BILLING_ERROR_CODES.idempotencyKeyRequired,
      correlationId,
      {
        status: HttpStatus.BAD_REQUEST,
      },
    );
  if (error instanceof Error && error.message === "INVALID_BILLING_INPUT")
    return problemException(
      BILLING_ERROR_CODES.validationFailed,
      correlationId,
      {
        status: HttpStatus.BAD_REQUEST,
      },
    );
  if (error instanceof BillingIdempotencyConflictError)
    return problemException(
      BILLING_ERROR_CODES.idempotencyConflict,
      correlationId,
      {
        status: HttpStatus.CONFLICT,
      },
    );
  if (error instanceof InvalidBillingInputError)
    return problemException(
      BILLING_ERROR_CODES.validationFailed,
      correlationId,
      {
        status: HttpStatus.BAD_REQUEST,
      },
    );
  if (error instanceof BillingOrderNotFoundError)
    return problemException(BILLING_ERROR_CODES.notFound, correlationId, {
      status: HttpStatus.NOT_FOUND,
    });
  return error;
}

export function mapUsageError(error: unknown) {
  const code =
    error instanceof OwnershipMismatchError
      ? BILLING_ERROR_CODES.ownershipMismatch
      : error instanceof BillingIdempotencyConflictError
        ? BILLING_ERROR_CODES.idempotencyConflict
        : error instanceof InvalidReservationTransitionError
          ? BILLING_ERROR_CODES.reservationTransition
          : error instanceof BillingConcurrencyError
            ? BILLING_ERROR_CODES.concurrencyConflict
            : error instanceof BillingDomainError
              ? BILLING_ERROR_CODES.validationFailed
              : null;
  if (!code) return error;
  const status =
    code === BILLING_ERROR_CODES.ownershipMismatch
      ? HttpStatus.FORBIDDEN
      : code === BILLING_ERROR_CODES.idempotencyConflict ||
          code === BILLING_ERROR_CODES.reservationTransition ||
          code === BILLING_ERROR_CODES.concurrencyConflict
        ? HttpStatus.CONFLICT
        : HttpStatus.BAD_REQUEST;
  return problemException(code, "billing-usage", { status });
}

/**
 * Business purpose: Map domain exceptions from Admin model pricing operations to RFC 7807 problem HTTP exceptions.
 *
 * Business rules:
 * - Domain not found errors map to 404 Not Found.
 * - Domain concurrency, idempotency conflict, overlap conflict, stale draft, and immutable snapshot errors map to 409 Conflict.
 * - Domain unlisted model, incomplete rates, invalid interval, and no coverage errors map to 422 Unprocessable Entity.
 * - Domain invalid billing input errors map to 400 Bad Request.
 * - Unknown non-domain errors are re-thrown without swallowing for global HttpExceptionFilter masking.
 *
 * Execution flow:
 * 1. Extract correlationId from request or default to "model-pricing-request".
 * 2. Match error against known domain error subclasses.
 * 3. Throw typed HttpException via problemException.
 * 4. Re-throw unhandled error.
 *
 * Failure cases:
 * - Always throws either a typed HttpException (for recognized domain errors) or the original error (for unexpected errors).
 *
 * Side effects:
 * - Pure error mapping without database or memory mutations.
 */
// Rationale ("Why"): Maps ModelPricing domain exceptions into RFC 7807 problem responses with consistent HTTP statuses.
// Mechanism ("How"): Matches against domain error types and calls problemException to generate standard problem objects before throwing.
// Invariants & Constraints: RFC 7807 envelope integrity preserved, correlationId attached, unknown errors rethrown for global masking.
export function mapModelPricingError(
  error: unknown,
  request: AuthenticatedRequest,
): never {
  const correlationId = request.correlationId ?? "model-pricing-request";

  if (error instanceof ModelPricingNotFoundError) {
    throw problemException(
      BILLING_ERROR_CODES.modelPricingNotFound,
      correlationId,
      { status: HttpStatus.NOT_FOUND },
    );
  }
  if (error instanceof ModelPricingOverlapConflictError) {
    throw problemException(
      BILLING_ERROR_CODES.modelPricingOverlapConflict,
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
  if (error instanceof ModelPricingImmutableSnapshotError) {
    throw problemException(
      BILLING_ERROR_CODES.modelPricingImmutableSnapshot,
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
  if (error instanceof ModelPricingStaleDraftError) {
    throw problemException(
      BILLING_ERROR_CODES.modelPricingStaleDraft,
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
  if (error instanceof ModelPricingInvalidStateError) {
    throw problemException(
      BILLING_ERROR_CODES.modelPricingInvalidState,
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
  if (error instanceof BillingIdempotencyConflictError) {
    throw problemException(
      BILLING_ERROR_CODES.idempotencyConflict,
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
  if (error instanceof BillingConcurrencyError) {
    throw problemException(
      BILLING_ERROR_CODES.concurrencyConflict,
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
  if (error instanceof ModelPricingUnlistedModelError) {
    throw problemException(
      BILLING_ERROR_CODES.modelPricingUnlistedModel,
      correlationId,
      { status: HttpStatus.UNPROCESSABLE_ENTITY },
    );
  }
  if (error instanceof ModelPricingIncompleteRatesError) {
    throw problemException(
      BILLING_ERROR_CODES.modelPricingIncompleteRates,
      correlationId,
      { status: HttpStatus.UNPROCESSABLE_ENTITY },
    );
  }
  if (error instanceof ModelPricingInvalidIntervalError) {
    throw problemException(
      BILLING_ERROR_CODES.modelPricingInvalidInterval,
      correlationId,
      { status: HttpStatus.UNPROCESSABLE_ENTITY },
    );
  }
  if (error instanceof ModelPricingNoCoverageError) {
    throw problemException(
      BILLING_ERROR_CODES.modelPricingNoCoverage,
      correlationId,
      { status: HttpStatus.UNPROCESSABLE_ENTITY },
    );
  }
  if (error instanceof InvalidBillingInputError) {
    throw problemException(
      BILLING_ERROR_CODES.validationFailed,
      correlationId,
      { status: HttpStatus.BAD_REQUEST },
    );
  }

  throw error;
}
