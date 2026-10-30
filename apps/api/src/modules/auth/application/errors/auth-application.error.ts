import {
  ApplicationError,
  type ApplicationErrorOptions,
} from "../../../../common/errors/application.error.ts";

/**
 * Auth use-case failure. Extends ApplicationError to preserve transport-neutral
 * application semantics, mapped to canonical problem envelopes by HttpExceptionFilter.
 */
export class AuthApplicationError extends ApplicationError {}

/**
 * Business purpose: Construct standardized application exceptions for Auth failures.
 *
 * Business rules:
 * - Emits transport-neutral application errors with stable codes and correlation IDs.
 * - Transport mapping to HTTP status is resolved at the edge by HttpExceptionFilter.
 *
 * Execution flow:
 * 1. Instantiate AuthApplicationError with code, correlationId, and options.
 * 2. Return typed AuthApplicationError.
 *
 * Failure cases:
 * - None: construction is deterministic.
 *
 * Side effects:
 * - Pure exception creation; no side effects or mutations.
 */
export function authFailure(
  code: string,
  correlationId: string,
  options?: ApplicationErrorOptions,
): AuthApplicationError {
  return new AuthApplicationError(code, correlationId, options);
}

export { APPLICATION_ERROR_REASONS as AUTH_FAILURE_REASONS } from "../../../../common/errors/application.error.ts";
