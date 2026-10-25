import type { ProblemMeta, RequiredAction } from "@lcsp/contracts/auth";

/** Transport-neutral application failure semantics. Mapping to HTTP belongs to
 * the outer HTTP boundary and must not be imported by application handlers. */
export const APPLICATION_ERROR_REASONS = {
  resourceAlreadyExists: "RESOURCE_ALREADY_EXISTS",
  resourceNotFound: "RESOURCE_NOT_FOUND",
  authenticationRequired: "AUTHENTICATION_REQUIRED",
  accessDenied: "ACCESS_DENIED",
} as const;

export type ApplicationErrorReason =
  (typeof APPLICATION_ERROR_REASONS)[keyof typeof APPLICATION_ERROR_REASONS];

export type ApplicationErrorOptions = {
  reason?: ApplicationErrorReason;
  meta?: ProblemMeta;
  requiredAction?: RequiredAction;
};

/** Stable application error with no NestJS or HTTP dependency. */
export class ApplicationError extends Error {
  readonly reason?: ApplicationErrorReason;
  readonly meta?: ProblemMeta;
  readonly requiredAction?: RequiredAction;

  constructor(
    readonly code: string,
    readonly correlationId: string,
    options: ApplicationErrorOptions = {},
  ) {
    super(code);
    this.name = new.target.name;
    this.reason = options.reason;
    this.meta = options.meta;
    this.requiredAction = options.requiredAction;
  }
}
