const SAFE_CODE_KEYS = new Set(["reason_code", "reasonCode"]);
const SENSITIVE_KEY_PATTERN = /password|token|secret|key|nonce|code|hash/i;

export interface SanitizeResult {
  payload: Record<string, unknown> | undefined;
  removedKeys: string[];
}

/**
 * Removes sensitive fields from audit payloads before they are persisted or logged.
 */
export class AuditSanitizer {
  /**
   * Sanitizes an audit payload recursively while recording every removed field path.
   *
   * @param payload - Optional structured audit payload to sanitize.
   * @returns The sanitized payload together with the paths of removed sensitive fields.
   */
  static sanitize(payload?: Record<string, unknown>): SanitizeResult {
    if (!payload) {
      return { payload: undefined, removedKeys: [] };
    }

    const removedKeys: string[] = [];
    return {
      payload: sanitizeRecord(payload, "", removedKeys),
      removedKeys,
    };
  }
}

/**
 * Sanitizes the fields of an object and tracks removed sensitive keys using dotted paths.
 *
 * @param value - Record whose fields should be inspected.
 * @param parentPath - Path prefix used when reporting nested removed keys.
 * @param removedKeys - Mutable collection that receives removed field paths.
 * @returns A copy of the record with sensitive fields removed.
 */
function sanitizeRecord(
  value: Record<string, unknown>,
  parentPath: string,
  removedKeys: string[],
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      const path = parentPath ? `${parentPath}.${key}` : key;
      if (SAFE_CODE_KEYS.has(key)) {
        return [[key, sanitizeValue(child, path, removedKeys)]];
      }
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        removedKeys.push(path);
        return [];
      }
      return [[key, sanitizeValue(child, path, removedKeys)]];
    }),
  );
}

/**
 * Sanitizes nested records and arrays while preserving primitive values.
 *
 * @param value - Value to inspect for nested records.
 * @param path - Current field path used for removed-key reporting.
 * @param removedKeys - Mutable collection that receives removed field paths.
 * @returns The sanitized value.
 */
function sanitizeValue(
  value: unknown,
  path: string,
  removedKeys: string[],
): unknown {
  if (Array.isArray(value)) {
    const items: unknown[] = value;
    return items.map((item, index) =>
      isRecord(item)
        ? sanitizeRecord(item, `${path}[${index}]`, removedKeys)
        : item,
    );
  }
  return isRecord(value) ? sanitizeRecord(value, path, removedKeys) : value;
}

/**
 * Determines whether a value is a non-array object that can be sanitized as a record.
 *
 * @param value - Value to inspect.
 * @returns True when the value is a record-like object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
