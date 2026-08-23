import type { AssessmentRuntimeSummaryValue } from "@lcsp/contracts/evidence";

const FALLBACK_SUMMARY = "Summary unavailable due to privacy policy";

type SummaryOptions = {
  maxDepth?: number;
  maxItems?: number;
  maxStringLength?: number;
};

/**
 * Converts an arbitrary runtime summary into bounded, non-sensitive display text.
 *
 * @param value - Candidate summary value to validate and sanitize.
 * @returns Sanitized summary text or the privacy-safe fallback when the value is empty or unsafe.
 */
export function sanitizeRuntimeSummaryText(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return FALLBACK_SUMMARY;
  }
  return truncate(value.trim(), 240);
}

/**
 * Recursively sanitizes structured runtime input/output summaries while enforcing depth, item, and string limits.
 *
 * @param value - Arbitrary runtime value to summarize safely.
 * @param options - Optional traversal and output-size limits.
 * @returns Privacy-safe summary value, or null when the value cannot be represented safely.
 */
export function sanitizeRuntimeSummaryValue(
  value: unknown,
  options: SummaryOptions = {},
): AssessmentRuntimeSummaryValue | null {
  const maxDepth = options.maxDepth ?? 4;
  const maxItems = options.maxItems ?? 12;
  const maxStringLength = options.maxStringLength ?? 160;

  try {
    return sanitizeValue(value, {
      depth: 0,
      maxDepth,
      maxItems,
      maxStringLength,
    });
  } catch {
    return null;
  }
}

/**
 * Produces a safe, bounded summary for an unknown runtime failure.
 *
 * @param error - Error object, string, or arbitrary thrown value.
 * @returns Sanitized error message or the privacy-safe fallback.
 */
export function summarizeRuntimeError(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeRuntimeSummaryText(error.message);
  }
  if (typeof error === "string") {
    return sanitizeRuntimeSummaryText(error);
  }
  return FALLBACK_SUMMARY;
}

type InternalOptions = {
  depth: number;
  maxDepth: number;
  maxItems: number;
  maxStringLength: number;
};

/**
 * Recursively converts one runtime value into the supported privacy-safe summary representation.
 *
 * @param value - Runtime value to inspect.
 * @param options - Current traversal depth and configured summary limits.
 * @returns Sanitized summary-compatible value, or null when the input should be omitted.
 */
function sanitizeValue(
  value: unknown,
  options: InternalOptions,
): AssessmentRuntimeSummaryValue | null {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }

  if (typeof value === "string") {
    return truncate(value, options.maxStringLength);
  }

  if (Array.isArray(value)) {
    if (options.depth >= options.maxDepth) {
      return value.length;
    }
    return value
      .slice(0, options.maxItems)
      .map((entry) =>
        sanitizeValue(entry, { ...options, depth: options.depth + 1 }),
      )
      .filter((entry) => entry !== null);
  }

  if (!isRecord(value)) {
    return null;
  }

  if (options.depth >= options.maxDepth) {
    return { truncated: "max_depth" };
  }

  const sanitized: Record<string, AssessmentRuntimeSummaryValue> = {};
  for (const [rawKey, nestedValue] of Object.entries(value).slice(
    0,
    options.maxItems,
  )) {
    const next = sanitizeValue(nestedValue, {
      ...options,
      depth: options.depth + 1,
    });
    if (next !== null) {
      sanitized[rawKey] = next;
    }
  }
  return sanitized;
}

/**
 * Limits a string to the requested length and adds an ellipsis when truncation is required.
 *
 * @param value - String to limit.
 * @param maxLength - Maximum output length.
 * @returns Original or truncated string.
 */
function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

/**
 * Determines whether a runtime value can be traversed as a non-array record.
 *
 * @param value - Value to inspect.
 * @returns True for non-null object values that are not arrays.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export { FALLBACK_SUMMARY };
