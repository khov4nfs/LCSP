import { isRecord } from "../../common/utils/index.js";

const SAFE_CODE_KEYS = new Set([
  "reason_code",
  "reasonCode",
  "statement_key",
  "statementKey",
  "claim_key",
  "claimKey",
  "idempotency_key",
  "idempotencyKey",
]);
const SENSITIVE_KEY_PATTERN = /password|token|secret|key|nonce|code|hash/i;
const MAX_AUDIT_STRING_LENGTH = 4096;
const REDACTED_VALUE = "[REDACTED]";
const TRUNCATED_VALUE = "...[TRUNCATED]";
const SENSITIVE_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s/@]+:)[^@\s/]+@/gi,
  /((?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*)[^\s,;]+/gi,
] as const;

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
  if (typeof value === "string") {
    let sanitized = value;
    for (const pattern of SENSITIVE_VALUE_PATTERNS) {
      pattern.lastIndex = 0;
      sanitized = sanitized.replace(pattern, (match, prefix?: string) =>
        typeof prefix === "string" && prefix.length > 0
          ? `${prefix}${REDACTED_VALUE}${match.endsWith("@") ? "@" : ""}`
          : REDACTED_VALUE,
      );
    }
    if (sanitized.length > MAX_AUDIT_STRING_LENGTH) {
      sanitized = `${sanitized.slice(0, MAX_AUDIT_STRING_LENGTH)}${TRUNCATED_VALUE}`;
    }
    if (sanitized !== value) {
      removedKeys.push(path);
    }
    return sanitized;
  }
  if (Array.isArray(value)) {
    const items: unknown[] = value;
    return items.map((item, index) =>
      sanitizeValue(item, `${path}[${index}]`, removedKeys),
    );
  }
  return isRecord(value) ? sanitizeRecord(value, path, removedKeys) : value;
}
