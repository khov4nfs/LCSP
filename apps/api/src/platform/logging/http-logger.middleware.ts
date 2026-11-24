import { Injectable, Logger, type NestMiddleware } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";

import { readProblemResponseMetadata } from "../http/filters/error-response-metadata.js";

/**
 * Logs completed HTTP requests with duration and standardized problem metadata when available.
 */
@Injectable()
export class HttpLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger("HTTP");

  /**
   * Registers completion logging for an HTTP request and then passes control to the next middleware.
   *
   * @param request - Express request whose method and URL are included in the log entry.
   * @param response - Express response used to read the final status and problem metadata.
   * @param next - Callback that continues the middleware chain.
   */
  use(request: Request, response: Response, next: NextFunction): void {
    const { method, originalUrl } = request;
    const startTime = Date.now();

    response.on("finish", () => {
      const { statusCode } = response;
      const duration = Date.now() - startTime;
      const message = formatHttpLogMessage(
        method,
        originalUrl,
        statusCode,
        duration,
        response,
      );

      if (statusCode >= 500) {
        this.logger.error(message);
      } else if (statusCode >= 400) {
        this.logger.warn(message);
      } else {
        this.logger.log(message);
      }
    });

    next();
  }
}

const SENSITIVE_QUERY_PARAM_PATTERN =
  /^(?:code|state|token|secret|signature|password|key|nonce|credential|otp|totp)$/i;

/**
 * Business purpose:
 * Redacts sensitive credentials, authorization codes, nonces, and secrets from HTTP request URLs before logging.
 *
 * Business rules:
 * - Inspects query string parameters of incoming request URLs.
 * - Detects sensitive parameter keys (such as OAuth authorization code, CSRF/OAuth state, tokens, signatures).
 * - Replaces their values with [REDACTED] to ensure zero secret leakage in application log files.
 *
 * Execution flow:
 * 1. Checks if the URL string exists and contains a query delimiter ("?").
 * 2. Splits URL into the base path and query component.
 * 3. Inspects each key-value pair; if the parameter key matches sensitive parameter patterns, replaces the value with [REDACTED].
 * 4. Re-assembles and returns the sanitized URL string.
 *
 * Failure cases:
 * - Returns original input unchanged if input is empty or non-string or lacks query parameters.
 *
 * Side effects:
 * - Pure string transformation; no external mutations or side effects.
 */
export function sanitizeUrlForLogging(rawUrl: string): string {
  // Rationale: OAuth redirects and external webhooks often supply credentials or ephemeral codes in query parameters.
  // Mechanism: Parses query parameters by delimiter, checks parameter names against SENSITIVE_QUERY_PARAM_PATTERN, and replaces values.
  // Invariants: Path segments, safe query keys, and non-sensitive parameters are preserved without modification.
  if (!rawUrl || typeof rawUrl !== "string") {
    return rawUrl;
  }
  const qIndex = rawUrl.indexOf("?");
  if (qIndex === -1) {
    return rawUrl;
  }
  const basePath = rawUrl.slice(0, qIndex);
  const queryString = rawUrl.slice(qIndex + 1);
  const sanitizedParams = queryString.split("&").map((pair) => {
    const eqIndex = pair.indexOf("=");
    if (eqIndex === -1) {
      return pair;
    }
    const key = pair.slice(0, eqIndex);
    if (SENSITIVE_QUERY_PARAM_PATTERN.test(decodeURIComponent(key))) {
      return `${key}=[REDACTED]`;
    }
    return pair;
  });
  return `${basePath}?${sanitizedParams.join("&")}`;
}

/**
 * Builds the structured HTTP log message for a completed response.
 *
 * @param method - HTTP method used by the request.
 * @param originalUrl - Original request URL before router transformations.
 * @param statusCode - Final HTTP response status code.
 * @param duration - Request duration in milliseconds.
 * @param response - Express response that may contain standardized problem metadata.
 * @returns A formatted log line suitable for the Nest logger.
 */
function formatHttpLogMessage(
  method: string,
  originalUrl: string,
  statusCode: number,
  duration: number,
  response: Response,
): string {
  const sanitizedUrl = sanitizeUrlForLogging(originalUrl);
  const baseMessage = `${method} ${sanitizedUrl} ${statusCode} +${duration}ms`;
  const problem = readProblemResponseMetadata(response);
  if (!problem) {
    return baseMessage;
  }

  return `${baseMessage} code=${problem.code} requiredAction=${problem.requiredAction} correlationId=${problem.correlationId}`;
}
