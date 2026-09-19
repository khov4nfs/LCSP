import { HttpStatus } from "@nestjs/common";
import { BILLING_ERROR_CODES } from "@lcsp/contracts/billing";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import {
  BillingConcurrencyError,
  BillingDomainError,
  BillingIdempotencyConflictError,
  InsufficientCreditError,
  InvalidBillingInputError,
  InvalidReservationTransitionError,
  OwnershipMismatchError,
  BillingOrderNotFoundError,
} from "../../../domain/billing.errors.js";
import type { AuthenticatedRequest } from "../../../../../common/interfaces/authenticated-request.interface.js";

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
    error instanceof InsufficientCreditError
      ? BILLING_ERROR_CODES.insufficientCredits
      : error instanceof OwnershipMismatchError
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
    code === BILLING_ERROR_CODES.insufficientCredits
      ? HttpStatus.PAYMENT_REQUIRED
      : code === BILLING_ERROR_CODES.ownershipMismatch
        ? HttpStatus.FORBIDDEN
        : code === BILLING_ERROR_CODES.idempotencyConflict ||
            code === BILLING_ERROR_CODES.reservationTransition ||
            code === BILLING_ERROR_CODES.concurrencyConflict
          ? HttpStatus.CONFLICT
          : HttpStatus.BAD_REQUEST;
  return problemException(code, "billing-usage", { status });
}
