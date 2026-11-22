import compression from "compression";
import type { INestApplication } from "@nestjs/common";
import helmet from "helmet";

/**
 * Configuration options for network edge security and performance middlewares.
 */
export interface NetworkEdgeOptions {
  /**
   * Additional allowed origins for CORS.
   */
  readonly allowedOrigins?: ReadonlyArray<string>;
}

/**
 * Resolves CORS origin whitelist safely.
 * Allows requests with no origin (e.g. server-side BFF curl/fetch, mobile apps, or local scripts).
 * In development and test environments, allows localhost origins (including IPv4 and IPv6 [::1]) by default.
 *
 * @param allowedOrigins Explicit allowed origin array.
 * @returns CORS origin handler function compatible with Express / NestJS.
 */
export function resolveCorsOrigin(
  allowedOrigins: ReadonlyArray<string> = [],
): (
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
) => void {
  const allowedSet = new Set(
    allowedOrigins.map((item) => item.trim()).filter((item) => item.length > 0),
  );

  return (origin, callback) => {
    // 1. Allow non-browser callers (Server-to-Server BFF, cron jobs, internal health probes)
    if (!origin) {
      callback(null, true);
      return;
    }

    // 2. Allow explicitly configured origins
    if (allowedSet.has(origin)) {
      callback(null, true);
      return;
    }

    // 3. Fallback for development/test environments (IPv4, IPv6 localhost)
    const isDev =
      process.env.NODE_ENV === "development" ||
      process.env.NODE_ENV === "test" ||
      !process.env.NODE_ENV;

    if (
      isDev &&
      /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin)
    ) {
      callback(null, true);
      return;
    }

    // Reject all other unapproved origins
    callback(null, false);
  };
}

/**
 * Business purpose:
 * Applies enterprise-grade network edge security and performance middlewares to the NestJS application.
 *
 * Business rules:
 * 1. Security Headers: Enforces HTTP security headers via Helmet (nosniff, frameguard, xssFilter). HSTS is strictly disabled in non-production to avoid locking local dev HTTP.
 * 2. Response Compression: Compresses outgoing responses using Gzip/Deflate for payloads > 1KB. Streaming SSE (text/event-stream) and binary files (PDF, DOCX) are excluded to prevent streaming latency or redundant compression.
 * 3. CORS Isolation: Restricts browser cross-origin requests to approved origins and exposes required LCSP trace and verification headers.
 *
 * Execution flow:
 * 1. Attach Helmet security middleware with safe defaults and conditional HSTS.
 * 2. Attach Gzip compression middleware with 1024-byte threshold, excluding SSE and binaries.
 * 3. Enable CORS with credentials support, complete LCSP allowed/exposed headers, and dynamic origin resolution.
 *
 * Failure cases:
 * - Rejects unauthorized browser cross-origin origins via standard CORS rejection.
 *
 * Side effects:
 * - Mutates NestJS application pipeline by attaching Express middlewares and enabling CORS.
 *
 * @param app The NestJS application instance.
 * @param options Optional configuration overrides.
 */
export function applyNetworkEdgeMiddleware(
  app: INestApplication,
  options?: NetworkEdgeOptions,
): void {
  const isProduction = process.env.NODE_ENV === "production";

  // 1. HTTP Security Headers (Helmet)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      hsts: isProduction
        ? { maxAge: 31536000, includeSubDomains: true }
        : false, // Prevent HSTS caching on http://localhost during local dev
    }),
  );

  // 2. HTTP Response Compression (Gzip / Deflate)
  app.use(
    compression({
      threshold: 1024, // Only compress responses larger than 1 KiB
      filter: (req, res) => {
        const rawContentType = res.getHeader("content-type");
        const contentType = Array.isArray(rawContentType)
          ? rawContentType.join(";").toLowerCase()
          : typeof rawContentType === "string"
            ? rawContentType.toLowerCase()
            : "";

        // CRITICAL: Never buffer/compress Server-Sent Events (SSE) AI streaming tokens
        if (contentType.includes("text/event-stream")) {
          return false;
        }

        // Do not compress binary stream downloads (PDF, DOCX, octet-stream)
        if (
          contentType.includes("application/pdf") ||
          contentType.includes("application/vnd.openxmlformats") ||
          contentType.includes("application/octet-stream")
        ) {
          return false;
        }

        return compression.filter(req, res);
      },
    }),
  );

  // 3. CORS Configuration
  const configuredOrigins = options?.allowedOrigins ?? [];
  app.enableCors({
    origin: resolveCorsOrigin(configuredOrigins),
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-correlation-id",
      "x-workspace-id",
      "x-request-id",
      "x-forwarded-for",
      "x-worker-api-key",
      "x-lcsp-locale",
      "x-assessment-lease",
    ],
    exposedHeaders: [
      "x-correlation-id",
      "x-request-id",
      "content-disposition",
      "x-checksum-sha256",
      "x-content-fingerprint-sha256",
      "x-lcsp-source-artifact-sha256",
    ],
  });
}
