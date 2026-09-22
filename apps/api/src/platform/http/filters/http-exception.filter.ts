import { Catch, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import type { ProblemMeta, ProblemResult } from "@lcsp/contracts/auth";
import { randomUUID } from "node:crypto";

import {
  cleanString,
  isNumber,
  isRecord,
} from "../../../common/utils/index.js";
import { setProblemResponseMetadata } from "./error-response-metadata.js";
import {
  defaultErrorCodeForStatus,
  internalServerProblem,
  isProblemResult,
  problemResult,
} from "./error.factory.js";

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
  correlationId?: string;
};

/**
 * Converts uncaught HTTP/application exceptions into the API's standardized problem-result contract and logs failures by severity.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  /**
   * Handles an exception, derives HTTP/correlation metadata, and writes a normalized problem response.
   *
   * @param exception - Exception or arbitrary thrown value raised during request handling.
   * @param host - Nest arguments host used to access the current HTTP request and response.
   */
  catch(exception: unknown, host: ArgumentsHost) {
    if (typeof host?.getType === "function" && host.getType() !== "http") {
      this.logger.error(
        `Non-HTTP exception caught in HttpExceptionFilter (${host.getType()}): ${formatExceptionBody(exception)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
      return;
    }

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

    const result = toProblemResult(body, correlationId, status);
    setProblemResponseMetadata(response, result);
    response.status(status).json(result);
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
  if (typeof body === "object") {
    try {
      return JSON.stringify(body);
    } catch (error) {
      return error instanceof Error ? error.message : "unserializable_body";
    }
  }
  return "unknown_body";
}

/**
 * Extracts descriptive metadata from an exception response body when available.
 *
 * @param body - Raw exception response body.
 * @returns Sanitized problem metadata or undefined.
 */
function extractProblemMeta(body: unknown): ProblemMeta | undefined {
  const cleaned = cleanString(body);
  if (cleaned) {
    return { message: cleaned };
  }
  if (isRecord(body)) {
    const meta: ProblemMeta = {};
    const messageCleaned = cleanString(body.message);
    if (messageCleaned) {
      meta.message = messageCleaned;
    } else if (Array.isArray(body.message)) {
      const messages = body.message
        .map(cleanString)
        .filter((item): item is string => item !== null)
        .join("; ");
      if (messages.length > 0) {
        meta.message = messages;
      }
    }
    const errorCleaned = cleanString(body.error);
    if (errorCleaned && !meta.message) {
      meta.error = errorCleaned;
    }
    return Object.keys(meta).length > 0 ? meta : undefined;
  }
  return undefined;
}

/**
 * Preserves a valid problem result or wraps an unknown exception body in the appropriate status problem shape.
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

  const code = defaultErrorCodeForStatus(status);
  const meta = extractProblemMeta(body);

  return problemResult(code, correlationId, {
    status,
    meta,
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
  if (isRecord(exception)) {
    if (isNumber(exception.status)) {
      return exception.status;
    }
    if (isNumber(exception.statusCode)) {
      return exception.statusCode;
    }
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

  const requestCorrelationId = cleanString(request.correlationId);
  if (requestCorrelationId) {
    return requestCorrelationId;
  }

  const header = request.headers?.["x-correlation-id"];
  const headerValue = cleanString(Array.isArray(header) ? header[0] : header);
  if (headerValue) {
    return headerValue;
  }

  return randomUUID();
}
