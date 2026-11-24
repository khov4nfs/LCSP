import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

import {
  emitDevUnsafeTrace,
  unsafeDevTraceEnabled,
} from "./dev-unsafe-trace.js";

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "proxy-authorization",
]);

/**
 * Business purpose:
 * Determines if an incoming HTTP route path targets a sensitive endpoint (authentication,
 * provider credentials, or payment webhooks) that must be strictly excluded from unsafe developer tracing.
 *
 * Business rules:
 * - Completely excludes all /auth/* paths (sign-in, sign-up, password re-auth, MFA enrollment/verification,
 *   recovery codes, OAuth linking/callbacks, session management, and sensitive route gates).
 * - Completely excludes all /provider-credentials/* paths (PAT tokens, integration keys).
 * - Completely excludes all /billing/sepay/* paths (payment webhooks, transaction proofs, signatures).
 *
 * Execution flow:
 * 1. Checks if the routePath string is present.
 * 2. Strips query parameters and URL fragment from the path.
 * 3. Evaluates against the regex matching sensitive path prefixes.
 * 4. Returns true if matching a sensitive path, false otherwise.
 *
 * Failure cases:
 * - Returns false for empty or non-string paths.
 *
 * Side effects:
 * - Pure function, no external side effects.
 */
export function isSensitiveHttpTraceRoute(routePath: string): boolean {
  // Rationale: Prevent credential leaks in diagnostic traces during local development or testing.
  // Mechanism: Normalizes the route path by stripping query strings and testing against a strict prefix pattern.
  // Invariants: Any route under /auth, /provider-credentials, or /billing/sepay is unconditionally excluded from tracing.
  if (!routePath || typeof routePath !== "string") {
    return false;
  }
  const cleanPath = routePath.split(/[?#]/)[0].toLowerCase().trim();
  return /^\/(?:billing\/sepay(?:\/.*)?|provider-credentials(?:\/.*)?|auth(?:\/.*)?)$/i.test(
    cleanPath,
  );
}

function sanitizeHeaders(
  headers: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!headers || typeof headers !== "object") return headers;
  return Object.fromEntries(
    Object.entries(headers).map(([key, val]) => {
      if (SENSITIVE_HEADER_NAMES.has(key.toLowerCase())) {
        return [key, "[REDACTED]"];
      }
      return [key, val];
    }),
  );
}

function sanitizeRawHeaders(
  rawHeaders: string[] | undefined,
): string[] | undefined {
  if (!Array.isArray(rawHeaders)) return rawHeaders;
  const sanitized = [...rawHeaders];
  for (let i = 0; i < sanitized.length; i += 2) {
    const name = sanitized[i];
    if (
      typeof name === "string" &&
      SENSITIVE_HEADER_NAMES.has(name.toLowerCase())
    ) {
      if (i + 1 < sanitized.length) {
        sanitized[i + 1] = "[REDACTED]";
      }
    }
  }
  return sanitized;
}

function sanitizeCookiesObject(cookies: unknown): unknown {
  if (!cookies || typeof cookies !== "object") return cookies;
  return Object.fromEntries(
    Object.keys(cookies as Record<string, unknown>).map((key) => [
      key,
      "[REDACTED]",
    ]),
  );
}

function sanitizeResponseHeaders(
  headers: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!headers || typeof headers !== "object") return headers;
  return Object.fromEntries(
    Object.entries(headers).map(([key, val]) => {
      if (SENSITIVE_HEADER_NAMES.has(key.toLowerCase())) {
        return [key, "[REDACTED]"];
      }
      return [key, val];
    }),
  );
}

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
    // Rationale: Sensitive routes handling passwords, PATs, MFA secrets, OAuth codes, or payment webhooks
    // must never be logged or traced, even when unsafe development tracing is explicitly requested.
    // Mechanism: Evaluates request.path, request.originalUrl, and request.url against isSensitiveHttpTraceRoute.
    // Invariants: Requests targeting sensitive routes pass through immediately without attaching any trace listeners.
    if (
      isSensitiveHttpTraceRoute(request.path) ||
      isSensitiveHttpTraceRoute(request.originalUrl) ||
      isSensitiveHttpTraceRoute(request.url)
    ) {
      next();
      return;
    }
    if (!unsafeDevTraceEnabled()) {
      next();
      return;
    }

    const startedAt = Date.now();
    let responseBody: unknown;

    const sanitizedHeaders = sanitizeHeaders(request.headers);
    const sanitizedRawHeaders = sanitizeRawHeaders(request.rawHeaders);
    const sanitizedCookies = sanitizeCookiesObject(
      (request as Request & { cookies?: unknown }).cookies,
    );
    const sanitizedSignedCookies = sanitizeCookiesObject(
      (request as Request & { signedCookies?: unknown }).signedCookies,
    );

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
      headers: sanitizedHeaders,
      rawHeaders: sanitizedRawHeaders,
      query: request.query,
      params: request.params,
      body: request.body,
      cookies: sanitizedCookies,
      signedCookies: sanitizedSignedCookies,
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
        responseHeaders: sanitizeResponseHeaders(response.getHeaders()),
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
          responseHeaders: sanitizeResponseHeaders(response.getHeaders()),
          responseBody,
        });
      }
    });

    next();
  }
}
