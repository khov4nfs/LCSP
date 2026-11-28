import { createCorrelationId } from "../security/crypto.utils.js";

export const SAFE_CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Business purpose: Preserve safe distributed trace identifiers across RBAC persistence and logging boundaries.
 * Business rules:
 * - Client/worker values must use the bounded trace-safe character set; absent or unsafe values are never retained.
 * Execution flow:
 * 1. Select the first scalar value, trim it, and validate the canonical pattern.
 * 2. Preserve a valid trace ID or generate a server-owned correlation ID.
 * Failure cases:
 * - Empty, oversized, multi-line, control-character, or otherwise invalid input is replaced safely.
 * Side effects:
 * - May generate one cryptographically random server correlation identifier.
 */
export function normalizeCorrelationId(value: unknown): string {
  const scalar: unknown = Array.isArray(value)
    ? (value as unknown[])[0]
    : value;
  const candidate = typeof scalar === "string" ? scalar.trim() : "";
  return SAFE_CORRELATION_ID_PATTERN.test(candidate)
    ? candidate
    : createCorrelationId();
}
