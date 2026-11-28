import { HttpException, HttpStatus } from "@nestjs/common";
import { SHARED_ERROR_CODES } from "@lcsp/contracts/shared";
import { ZodError } from "zod";

import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { ArtifactStorageIntegrityError } from "../../../../platform/storage/artifact-storage.service.js";

const DEPENDENCY_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "EIO",
  "EACCES",
  "EMFILE",
  "ENFILE",
  "ENETUNREACH",
  "ENOENT",
  "ENOSPC",
  "EPIPE",
  "EROFS",
  "ETIMEDOUT",
  "P1001",
  "P1002",
  "P1008",
  "P1017",
  "P2024",
  "P2028",
  // Prisma reports transaction write conflicts and deadlocks as P2034. The
  // operation is retryable, so expose bounded unavailability instead of a 500.
  "P2034",
]);
const FINAL_REPORT_DEPENDENCY_TIMEOUT_MS = 30_000;

/** Marks a verified final-report schema, manifest, pin, or hash violation. */
export class FinalReportIntegrityError extends Error {}

/**
 * Business purpose: Bound synchronous final-report dependency work so publication cannot hang indefinitely.
 *
 * Business rules:
 * - The default deadline applies only to storage operations outside database transaction timeouts.
 * - Deadline expiry uses the allowlisted ETIMEDOUT code and is therefore exposed only as safe 503.
 *
 * Execution flow:
 * 1. Start a deadline timer beside the supplied operation.
 * 2. Resolve or reject with whichever completes first.
 * 3. Clear the timer after either outcome.
 *
 * Failure cases:
 * - Deadline expiry rejects with a structured timeout error; original operation failures propagate unchanged.
 *
 * Side effects:
 * - Schedules and clears one in-process timer; it cannot cancel an underlying provider operation.
 */
export async function withFinalReportDependencyDeadline<T>(
  operation: Promise<T>,
  timeoutMs = FINAL_REPORT_DEPENDENCY_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        Object.assign(new Error("Final-report dependency deadline exceeded"), {
          code: "ETIMEDOUT",
        }),
      );
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Business purpose: Extract a bounded machine error code for classification and safe telemetry.
 *
 * Business rules:
 * - Only a direct string `code` property is accepted; messages and nested provider payloads are ignored.
 *
 * Execution flow:
 * 1. Reject non-object failures.
 * 2. Read the direct code property as an unknown value.
 * 3. Return it only when it is a string.
 *
 * Failure cases:
 * - Missing or non-string codes return undefined.
 *
 * Side effects:
 * - Pure inspection; does not mutate or log the failure.
 */
export function finalReportFailureCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const record = error as Record<string, unknown>;
  return typeof record.code === "string" ? record.code : undefined;
}

/**
 * Business purpose: Identify retryable infrastructure failures without exposing provider details.
 *
 * Business rules:
 * - Only the bounded filesystem, network, and Prisma timeout/unavailability codes are retryable.
 * - Arbitrary error messages never influence classification because they may contain secrets.
 *
 * Execution flow:
 * 1. Read the structured `code` field from an object-like failure.
 * 2. Compare it with the approved dependency code allowlist.
 * 3. Return whether the caller may safely report service unavailability.
 *
 * Failure cases:
 * - Missing, malformed, or unknown codes return false and fall through to masked 500 handling.
 *
 * Side effects:
 * - Pure classification; no logging, persistence, or external calls.
 */
export function isFinalReportDependencyUnavailable(error: unknown): boolean {
  const code = finalReportFailureCode(error);
  return code !== undefined && DEPENDENCY_ERROR_CODES.has(code);
}

/**
 * Business purpose: Convert final-report failures into the stable public API error boundary.
 *
 * Business rules:
 * - Existing application problems retain their status and code.
 * - Verified artifact corruption is a 409 conflict, retryable dependencies are 503, and every
 *   unclassified internal failure is a masked 500.
 * - Only explicit storage/report integrity markers are rewritten as report conflicts.
 *
 * Execution flow:
 * 1. Map integrity markers, parser failures, and storage validation failures to FINAL_REPORT_INVALID.
 * 2. Preserve already-standardized HTTP exceptions.
 * 3. Map allowlisted dependency failures to UPSTREAM_UNAVAILABLE.
 * 4. Mask all remaining failures as INTERNAL_ERROR.
 *
 * Failure cases:
 * - The returned exception never includes the original message, hostname, path, or provider payload.
 *
 * Side effects:
 * - Pure exception construction; callers remain responsible for correlation-safe server logging.
 */
export function classifyFinalReportFailure(
  error: unknown,
  correlationId: string,
  finalReportInvalidCode: string,
): HttpException {
  if (
    error instanceof FinalReportIntegrityError ||
    error instanceof ArtifactStorageIntegrityError ||
    error instanceof SyntaxError ||
    error instanceof ZodError
  ) {
    return problemException(finalReportInvalidCode, correlationId, {
      status: HttpStatus.CONFLICT,
    });
  }
  if (error instanceof HttpException) return error;
  if (isFinalReportDependencyUnavailable(error)) {
    return problemException(
      SHARED_ERROR_CODES.upstreamUnavailable,
      correlationId,
      {
        status: HttpStatus.SERVICE_UNAVAILABLE,
      },
    );
  }
  return problemException(SHARED_ERROR_CODES.internalError, correlationId, {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
  });
}
