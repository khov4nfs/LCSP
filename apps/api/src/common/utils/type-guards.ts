/**
 * Common Type Guards and String Sanitizers for apps/api.
 */

/**
 * Checks if an unknown value is a non-null object record (and not an array).
 *
 * @param value - Unknown value to inspect.
 * @returns True when the value is a Record<string, unknown>.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalizes a string value by trimming whitespace and returning null if empty or non-string.
 *
 * @param value - Unknown value to inspect and normalize.
 * @returns Trimmed non-empty string, or null if empty/invalid.
 */
export function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}
