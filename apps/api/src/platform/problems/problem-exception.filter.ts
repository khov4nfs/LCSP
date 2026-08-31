import { Catch, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import {
  AUTH_ERROR_CODES,
  createProblemResult,
  type ProblemResult,
} from "@lcsp/contracts/auth";
import { randomUUID } from "node:crypto";

import { setProblemResponseMetadata } from "./problem-response-metadata.js";
import { internalServerProblem } from "./problem-factory.js";

type HttpResponse = {
  locals?: Record<string, unknown>;
  status: (statusCode: number) => {
    json: (body: unknown) => void;
  };
};

type HttpRequest = {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
};

/**
 * Converts uncaught HTTP/application exceptions into the API's standardized problem-result contract and logs failures by severity.
 */
@Catch()
export class ProblemExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemExceptionFilter.name);

  /**
   * Handles an exception, derives HTTP/correlation metadata, and writes a normalized problem response.
   *
   * @param exception - Exception or arbitrary thrown value raised during request handling.
   * @param host - Nest arguments host used to access the current HTTP request and response.
   */
  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const response = context.getResponse<HttpResponse>();
    const request = context.getRequest<HttpRequest>();
    const status = getHttpStatus(exception);
    const body = getExceptionBody(exception);
    const correlationId = getCorrelationId(body, request);

    if (status >= 500) {
      this.logger.error(
        `[${correlationId}] ${request.method ?? "HTTP"} ${request.url ?? ""} ${status} - Internal Server Error`,
        exception instanceof Error
          ? exception.stack
          : formatExceptionBody(exception),
      );
    } else if (status >= 400) {
      this.logger.warn(
        `[${correlationId}] ${request.method ?? "HTTP"} ${request.url ?? ""} ${status} - ${formatExceptionBody(body || exception)}`,
      );
    }

    const problemResult = toProblemResult(body, correlationId, status);
    setProblemResponseMetadata(response, problemResult);
    response.status(status).json(problemResult);
  }
}

/**
 * Converts an arbitrary exception body into a safe log string.
 *
 * @param body - Exception body or thrown value to format.
 * @returns String representation suitable for logging.
 */
function formatExceptionBody(body: unknown): string {
  if (body === null || body === undefined) {
    return "null";
  }
  if (typeof body === "string") {
    return body;
  }
  if (
    typeof body === "number" ||
    typeof body === "boolean" ||
    typeof body === "bigint" ||
    typeof body === "symbol"
  ) {
    return String(body);
  }
  try {
    return JSON.stringify(body);
  } catch (error) {
    return error instanceof Error ? error.message : "unserializable_body";
  }
}

/**
 * Preserves a valid problem result or wraps an unknown exception body in the default validation problem shape.
 *
 * @param body - Exception response body to normalize.
 * @param correlationId - Correlation identifier attached to the normalized problem.
 * @param status - HTTP status to expose in the response.
 * @returns Standardized problem result.
 */
function toProblemResult(
  body: unknown,
  correlationId: string,
  status: number,
): ProblemResult<string> {
  if (isProblemResult(body)) {
    return {
      ok: false,
      problem: {
        ...body.problem,
        status,
        correlationId: body.problem.correlationId || correlationId,
      },
    };
  }

  if (status >= Number(HttpStatus.INTERNAL_SERVER_ERROR)) {
    return internalServerProblem(correlationId);
  }

  return createProblemResult(AUTH_ERROR_CODES.validationFailed, correlationId, {
    status,
  });
}

/**
 * Extracts an HTTP status from supported exception shapes and defaults unknown errors to 500.
 *
 * @param exception - Thrown exception or arbitrary error value.
 * @returns HTTP status code for the response.
 */
function getHttpStatus(exception: unknown): number {
  if (exception instanceof HttpException) {
    return exception.getStatus();
  }
  if (
    exception !== null &&
    typeof exception === "object" &&
    typeof (exception as { status?: unknown }).status === "number"
  ) {
    return (exception as { status: number }).status;
  }
  if (
    exception !== null &&
    typeof exception === "object" &&
    typeof (exception as { statusCode?: unknown }).statusCode === "number"
  ) {
    return (exception as { statusCode: number }).statusCode;
  }

  return HttpStatus.INTERNAL_SERVER_ERROR;
}

/**
 * Reads the response body carried by a Nest HTTP exception.
 *
 * @param exception - Thrown value to inspect.
 * @returns Nest exception response body, or null for non-HTTP exceptions.
 */
function getExceptionBody(exception: unknown): unknown {
  if (exception instanceof HttpException) {
    return exception.getResponse();
  }

  return null;
}

/**
 * Resolves the correlation ID from an existing problem, the request header, or a generated UUID.
 *
 * @param body - Exception response body that may already contain problem correlation metadata.
 * @param request - HTTP request whose correlation header may be reused.
 * @returns Correlation identifier for logging and the response contract.
 */
function getCorrelationId(body: unknown, request: HttpRequest): string {
  if (isProblemResult(body) && body.problem.correlationId) {
    return body.problem.correlationId;
  }

  const header = request.headers?.["x-correlation-id"];
  const headerValue = Array.isArray(header) ? header[0] : header;
  if (headerValue) {
    return headerValue;
  }

  return randomUUID();
}

/**
 * Checks whether a runtime value matches the minimal standardized problem-result shape.
 *
 * @param body - Value to inspect.
 * @returns True when the value is a failed result containing a string problem code.
 */
function isProblemResult(body: unknown): body is ProblemResult<string> {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { ok?: unknown }).ok === false &&
    typeof (body as { problem?: { code?: unknown } }).problem?.code === "string"
  );
}
