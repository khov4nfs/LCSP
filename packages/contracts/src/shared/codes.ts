export const SHARED_ERROR_CODES = {
  badRequest: "BAD_REQUEST",
  unauthorized: "UNAUTHORIZED",
  forbidden: "FORBIDDEN",
  notFound: "NOT_FOUND",
  conflict: "CONFLICT",
  unprocessableEntity: "UNPROCESSABLE_ENTITY",
  validationFailed: "VALIDATION_FAILED",
  internalError: "INTERNAL_ERROR",
  upstreamUnavailable: "UPSTREAM_UNAVAILABLE",
  upstreamResponseInvalid: "UPSTREAM_RESPONSE_INVALID",
} as const;

export type SharedErrorCode =
  (typeof SHARED_ERROR_CODES)[keyof typeof SHARED_ERROR_CODES];
