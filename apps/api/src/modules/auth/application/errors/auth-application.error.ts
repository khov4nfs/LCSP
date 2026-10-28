import { HttpException } from "@nestjs/common";
import {
  APPLICATION_ERROR_REASONS,
  type ApplicationErrorReason,
} from "../../../../common/errors/application.error.ts";
import {
  problemException,
  type ProblemOptions,
} from "../../../../platform/http/filters/error.factory.js";

const APPLICATION_FAILURE_HTTP_STATUS: Record<ApplicationErrorReason, number> =
  {
    [APPLICATION_ERROR_REASONS.resourceAlreadyExists]: 409,
    [APPLICATION_ERROR_REASONS.resourceNotFound]: 404,
    [APPLICATION_ERROR_REASONS.authenticationRequired]: 401,
    [APPLICATION_ERROR_REASONS.accessDenied]: 403,
  };

export type AuthApplicationOptions = ProblemOptions & {
  reason?: ApplicationErrorReason;
};

/**
 * Canonical Auth HTTP application exception. Exposes problem contract and code
 * directly as a standard Nest HttpException.
 */
export class AuthApplicationError extends HttpException {
  readonly code: string;
  readonly correlationId: string;
  readonly reason?: ApplicationErrorReason;

  constructor(
    code: string,
    correlationId: string,
    options?: AuthApplicationOptions,
  ) {
    const status =
      options?.status ??
      (options?.reason
        ? APPLICATION_FAILURE_HTTP_STATUS[options.reason]
        : undefined);
    const exc = problemException(code, correlationId, {
      ...options,
      status,
    });
    super(exc.getResponse(), exc.getStatus());
    this.code = code;
    this.correlationId = correlationId;
    this.reason = options?.reason;
  }
}

/**
 * Business purpose: Construct standardized canonical HTTP problem exceptions for Auth failures.
 *
 * Business rules:
 * - Maps stable error codes and correlation metadata to standard HttpException payloads.
 * - Respects status overrides, failure reasons (such as resourceNotFound -> 404), required actions, and problem metadata.
 *
 * Execution flow:
 * 1. Instantiate AuthApplicationError wrapping problemException with reason-to-status resolution.
 * 2. Return typed HttpException.
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
  options?: AuthApplicationOptions,
): AuthApplicationError {
  return new AuthApplicationError(code, correlationId, options);
}

export { APPLICATION_ERROR_REASONS as AUTH_FAILURE_REASONS } from "../../../../common/errors/application.error.ts";
