import {
  ApplicationError,
  type ApplicationErrorOptions,
} from "../../../../common/errors/application.error.ts";

/** Auth use-case failure. API status and localization are resolved only at the
 * transport boundary using the shared problem catalog. */
export class AuthApplicationError extends ApplicationError {}

/** Builds an error without importing NestJS HttpStatus or problemException. */
export function authFailure(
  code: string,
  correlationId: string,
  options?: ApplicationErrorOptions,
): AuthApplicationError {
  return new AuthApplicationError(code, correlationId, options);
}
export { APPLICATION_ERROR_REASONS as AUTH_FAILURE_REASONS } from "../../../../common/errors/application.error.ts";
