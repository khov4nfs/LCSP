import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { SHARED_ERROR_CODES } from "@lcsp/contracts/shared";
import {
  PROBLEM_DEFAULTS,
  PROBLEM_KEYS,
  REQUIRED_ACTIONS,
  createProblemResult,
  type AppProblem,
  type AuthErrorCode,
  type ProblemKey,
  type RequiredAction,
  type ProblemMeta,
  type ProblemResult,
} from "@lcsp/contracts/auth";
import { isRecord } from "../../../common/utils/index.js";

export type ProblemOptions = {
  meta?: ProblemMeta;
  status?: number;
  requiredAction?: RequiredAction;
  titleKey?: ProblemKey;
  detailKey?: ProblemKey;
};

type ProblemExceptionFactory = (body: ProblemResult<string>) => HttpException;

const PROBLEM_EXCEPTION_FACTORIES: Record<number, ProblemExceptionFactory> = {
  [HttpStatus.BAD_REQUEST]: (body) => new BadRequestException(body),
  [HttpStatus.UNAUTHORIZED]: (body) => new UnauthorizedException(body),
  [HttpStatus.FORBIDDEN]: (body) => new ForbiddenException(body),
  [HttpStatus.NOT_FOUND]: (body) => new NotFoundException(body),
  [HttpStatus.CONFLICT]: (body) => new ConflictException(body),
  [HttpStatus.UNPROCESSABLE_ENTITY]: (body) =>
    new UnprocessableEntityException(body),
  [HttpStatus.BAD_GATEWAY]: (body) => new BadGatewayException(body),
};

/**
 * Builds the standardized API problem result for either a known auth error code or a generic application code.
 *
 * @param code - Stable problem code to expose to API clients.
 * @param correlationId - Correlation identifier attached to the problem response.
 * @param options - Optional HTTP status and structured problem metadata.
 * @returns Standardized failed result for the supplied problem code.
 */
export function problemResult<TCode extends string>(
  code: TCode,
  correlationId: string,
  options?: ProblemOptions,
): ProblemResult<TCode> {
  const status =
    options?.status ??
    (isAuthErrorCode(code)
      ? PROBLEM_DEFAULTS[code].status
      : HttpStatus.BAD_REQUEST);

  if (isAuthErrorCode(code)) {
    return createProblemResult(code, correlationId, {
      meta: options?.meta,
      status,
      requiredAction: options?.requiredAction,
    }) as ProblemResult<TCode>;
  }

  return {
    ok: false,
    problem: createGenericProblem(code, correlationId, {
      meta: options?.meta,
      status,
      requiredAction: options?.requiredAction,
      titleKey: options?.titleKey,
      detailKey: options?.detailKey,
    }),
  };
}

/**
 * Creates the Nest HTTP exception corresponding to a standardized problem result and status code.
 *
 * @param code - Stable application problem code.
 * @param correlationId - Correlation identifier attached to the problem response.
 * @param options - Optional HTTP status and structured problem metadata.
 * @returns Typed Nest exception when a specialized status exists, otherwise a generic HttpException.
 */
export function problemException<TCode extends string>(
  code: TCode,
  correlationId: string,
  options?: ProblemOptions,
): HttpException {
  const status =
    options?.status ??
    (isAuthErrorCode(code)
      ? PROBLEM_DEFAULTS[code].status
      : HttpStatus.BAD_REQUEST);
  const body = problemResult(code, correlationId, {
    meta: options?.meta,
    status,
    requiredAction: options?.requiredAction,
    titleKey: options?.titleKey,
    detailKey: options?.detailKey,
  });
  return (
    PROBLEM_EXCEPTION_FACTORIES[status]?.(body) ??
    new HttpException(body, status)
  );
}

/**
 * Resolves a default problem code for standard HTTP error statuses.
 *
 * @param status - Numeric HTTP status code.
 * @returns Standard error code from shared contracts.
 */
export function defaultErrorCodeForStatus(status: number): string {
  if (status === Number(HttpStatus.BAD_REQUEST)) {
    return SHARED_ERROR_CODES.badRequest;
  }
  if (status === Number(HttpStatus.UNAUTHORIZED)) {
    return SHARED_ERROR_CODES.unauthorized;
  }
  if (status === Number(HttpStatus.FORBIDDEN)) {
    return SHARED_ERROR_CODES.forbidden;
  }
  if (status === Number(HttpStatus.NOT_FOUND)) {
    return SHARED_ERROR_CODES.notFound;
  }
  if (status === Number(HttpStatus.CONFLICT)) {
    return SHARED_ERROR_CODES.conflict;
  }
  if (status === Number(HttpStatus.UNPROCESSABLE_ENTITY)) {
    return SHARED_ERROR_CODES.unprocessableEntity;
  }
  if (status >= 500) {
    return SHARED_ERROR_CODES.internalError;
  }
  return SHARED_ERROR_CODES.badRequest;
}

/**
 * Creates the fail-safe internal-server problem used when no more specific application problem is available.
 *
 * @param correlationId - Correlation identifier attached to the generated problem.
 * @returns Standardized 500 problem result.
 */
export function internalServerProblem(
  correlationId: string,
): ProblemResult<string> {
  return problemResult(SHARED_ERROR_CODES.internalError, correlationId, {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
  });
}

/**
 * Builds a generic problem definition for application-specific codes not present in the auth problem catalog.
 *
 * @param code - Stable application problem code.
 * @param correlationId - Correlation identifier attached to the problem.
 * @param options - HTTP status and optional metadata.
 * @returns Generic problem payload using shared fallback localization keys.
 */
function createGenericProblem<TCode extends string>(
  code: TCode,
  correlationId: string,
  options: ProblemOptions & { status: number },
): AppProblem<TCode> {
  return {
    type: `problem/${code.toLowerCase().replaceAll("_", "-")}`,
    status: options.status,
    code,
    titleKey: options.titleKey ?? PROBLEM_KEYS.validationFailedTitle,
    detailKey: options.detailKey ?? PROBLEM_KEYS.validationFailedDetail,
    requiredAction: options.requiredAction ?? REQUIRED_ACTIONS.none,
    correlationId,
    meta: options.meta,
  };
}

/**
 * Determines whether a problem code belongs to the shared authentication error catalog.
 *
 * @param code - Problem code to inspect.
 * @returns True when the code has configured auth problem defaults.
 */
function isAuthErrorCode(code: string): code is AuthErrorCode {
  return Object.hasOwn(PROBLEM_DEFAULTS, code);
}

/**
 * Checks whether a runtime value is a standardized failed API problem result.
 *
 * @param value - Value to inspect.
 * @returns True when the value contains a failed result with a string problem code.
 */
export function isProblemResult(
  value: unknown,
): value is ProblemResult<string> {
  return (
    isRecord(value) &&
    value.ok === false &&
    isRecord(value.problem) &&
    typeof value.problem.code === "string"
  );
}

/**
 * Wraps plain handler data in the standard success result envelope.
 *
 * @param data - Handler value to normalize.
 * @returns Standard success result object.
 */
export function resultEnvelope<TData>(data: TData): { ok: true; data: TData } {
  return {
    ok: true,
    data,
  };
}
