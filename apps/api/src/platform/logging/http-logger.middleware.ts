import { Injectable, Logger, type NestMiddleware } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";

import { readProblemResponseMetadata } from "../problems/problem-response-metadata.js";

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
  const baseMessage = `${method} ${originalUrl} ${statusCode} +${duration}ms`;
  const problem = readProblemResponseMetadata(response);
  if (!problem) {
    return baseMessage;
  }

  return `${baseMessage} code=${problem.code} requiredAction=${problem.requiredAction} correlationId=${problem.correlationId}`;
}
