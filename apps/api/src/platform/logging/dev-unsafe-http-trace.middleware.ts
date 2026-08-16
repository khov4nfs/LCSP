import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

import {
  emitDevUnsafeTrace,
  unsafeDevTraceEnabled,
} from "./dev-unsafe-trace.js";

/**
 * Development-only HTTP boundary trace that preserves exact request/response data.
 *
 * The middleware is a no-op unless LCSP_DEV_UNSAFE_TRACE=true. When enabled it
 * deliberately logs headers, cookies, query/params, body, and the response body
 * without applying the normal sensitive-data/source-code redaction rules.
 */
@Injectable()
export class DevUnsafeHttpTraceMiddleware implements NestMiddleware {
  /**
   * Captures the complete Express request and response lifecycle in unsafe dev mode.
   *
   * @param request - Incoming Express request, including raw headers/body/context.
   * @param response - Express response whose json/send methods are observed.
   * @param next - Callback that continues the middleware chain.
   */
  use(request: Request, response: Response, next: NextFunction): void {
    if (!unsafeDevTraceEnabled()) {
      next();
      return;
    }

    const startedAt = Date.now();
    let responseBody: unknown;

    emitDevUnsafeTrace("DEV_API_HTTP_REQUEST_RAW", {
      method: request.method,
      originalUrl: request.originalUrl,
      url: request.url,
      baseUrl: request.baseUrl,
      path: request.path,
      protocol: request.protocol,
      hostname: request.hostname,
      ip: request.ip,
      ips: request.ips,
      headers: request.headers,
      rawHeaders: request.rawHeaders,
      query: request.query,
      params: request.params,
      body: request.body,
      cookies: (request as Request & { cookies?: unknown }).cookies,
      signedCookies: (request as Request & { signedCookies?: unknown })
        .signedCookies,
    });

    const originalJson = response.json.bind(response) as (
      body: unknown,
    ) => Response;
    response.json = ((body: unknown) => {
      responseBody = body;
      emitDevUnsafeTrace("DEV_API_HTTP_RESPONSE_JSON_RAW", {
        method: request.method,
        originalUrl: request.originalUrl,
        statusCode: response.statusCode,
        body,
      });
      return originalJson(body);
    }) as Response["json"];

    const originalSend = response.send.bind(response) as (
      body?: unknown,
    ) => Response;
    response.send = ((body?: unknown) => {
      if (responseBody === undefined) {
        responseBody = body;
      }
      emitDevUnsafeTrace("DEV_API_HTTP_RESPONSE_SEND_RAW", {
        method: request.method,
        originalUrl: request.originalUrl,
        statusCode: response.statusCode,
        body,
      });
      return originalSend(body);
    }) as Response["send"];

    response.on("finish", () => {
      emitDevUnsafeTrace("DEV_API_HTTP_COMPLETED_RAW", {
        method: request.method,
        originalUrl: request.originalUrl,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt,
        responseHeaders: response.getHeaders(),
        responseBody,
      });
    });

    response.on("close", () => {
      if (!response.writableEnded) {
        emitDevUnsafeTrace("DEV_API_HTTP_CLOSED_EARLY_RAW", {
          method: request.method,
          originalUrl: request.originalUrl,
          statusCode: response.statusCode,
          durationMs: Date.now() - startedAt,
          responseHeaders: response.getHeaders(),
          responseBody,
        });
      }
    });

    next();
  }
}
