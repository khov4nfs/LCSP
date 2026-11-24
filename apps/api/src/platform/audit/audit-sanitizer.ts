import { isRecord } from "@lcsp/contracts/shared";

// Safe code identifiers, failure reason indicators, and correlation markers that must not be stripped even if they contain substrings like "code", "key", or "otp".
// Rationale: Audit event payloads preserve non-sensitive error and failure diagnostics (e.g. otp_failure_reason="invalid", recovery_code_failure_reason="replayed") while stripping actual secrets.
// Mechanism: Explicit allowlist checked before regex-based sensitive key pattern matching.
// Invariants: Actual OTP codes, TOTP secrets, passwords, tokens, and credentials remain stripped by SENSITIVE_KEY_PATTERN.
const SAFE_CODE_KEYS = new Set([
  "reason_code",
  "reasonCode",
  "statement_key",
  "statementKey",
  "claim_key",
  "claimKey",
  "idempotency_key",
  "idempotencyKey",
  "error_code",
  "errorCode",
  "status_code",
  "statusCode",
  "correlation_id",
  "correlationId",
  "otp_failure_reason",
  "otpFailureReason",
  "recovery_code_failure_reason",
  "recoveryCodeFailureReason",
]);

// Expanded regex matching keys that contain sensitive credentials, secrets, tokens, OTPs, or auth headers.
const SENSITIVE_KEY_PATTERN =
  /password|token|secret|key|nonce|code|hash|otp|totp|setup_?uri|otpauth|qr_?code|signature|credential|cookie|authorization/i;
const MAX_AUDIT_STRING_LENGTH = 4096;
const REDACTED_VALUE = "[REDACTED]";
const TRUNCATED_VALUE = "...[TRUNCATED]";

// Regular expressions to detect and redact sensitive patterns embedded within free-text strings.
const SENSITIVE_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s/@]+:)[^@\s/]+@/gi,
  /((?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*)[^\s,;]+/gi,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/g,
  /\botpauth:\/\/[^\s"'<>]+/gi,
  /\bsynthetic[-_]secret[-_A-Za-z0-9]+\b/gi,
] as const;

export interface SanitizeResult {
  payload: Record<string, unknown> | undefined;
  removedKeys: string[];
}

/**
 * Business purpose:
 * Sanitizes arbitrary text strings by scrubbing detected credentials, secrets, tokens, and URIs.
 *
 * Business rules:
 * - Scans strings against high-confidence sensitive credential patterns (bearer tokens, GitHub PATs, AI keys, OTP setup URIs, private keys).
 * - Replaces any matched secret substring with the canonical [REDACTED] placeholder.
 *
 * Execution flow:
 * 1. Validates that the input is a valid non-empty string; returns unmodified if empty.
 * 2. Iterates over SENSITIVE_VALUE_PATTERNS with pattern index reset.
 * 3. Replaces matched substrings with [REDACTED], preserving connection URI prefixes if captured.
 * 4. Returns the sanitized string.
 *
 * Failure cases:
 * - Returns empty string for empty input; does not throw.
 *
 * Side effects:
 * - Pure computation; no mutations or external side-effects.
 */
export function sanitizeStringSecrets(value: string): string {
  // Rationale: Prevent accidental secret exposure in free-text logs, error metadata, or audit fields.
  // Mechanism: Iterates through defined regex patterns with state reset to eliminate regex state pollution.
  // Invariants: Preserves surrounding formatting while ensuring matching secret tokens are completely masked.
  if (!value) {
    return value;
  }
  let sanitized = value;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    // Reset RegExp lastIndex to ensure accurate matching across consecutive invocations
    pattern.lastIndex = 0;
    sanitized = sanitized.replace(pattern, (match, prefix?: string) =>
      typeof prefix === "string" && prefix.length > 0
        ? `${prefix}${REDACTED_VALUE}${match.endsWith("@") ? "@" : ""}`
        : REDACTED_VALUE,
    );
  }
  return sanitized;
}

/**
 * Business purpose:
 * Recursively cleans sensitive string tokens inside arbitrary object records and nested collections without altering structure.
 *
 * Business rules:
 * - Traverses objects and arrays deeply.
 * - Masks any embedded secret string patterns with sanitizeStringSecrets.
 * - Preserves keys and non-string values intact.
 *
 * Execution flow:
 * 1. Checks if input is an object record; if not, returns value directly.
 * 2. For array items, maps each item through recursive sanitization.
 * 3. For record fields, recursively sanitizes each value and builds a sanitized clone.
 *
 * Failure cases:
 * - Returns unchanged for non-record primitive inputs.
 *
 * Side effects:
 * - Pure computation; produces a new object without mutating input arguments.
 */
export function sanitizeRecordSecrets<T extends Record<string, unknown>>(
  record: T,
): T {
  // Rationale: Used by logging middleware and exception filters to sanitize payloads while keeping original key structure intact.
  // Mechanism: Recursive traversal checking isRecord and Array.isArray, delegating string sanitization to sanitizeStringSecrets.
  // Invariants: Does not mutate the original record or drop existing keys.
  if (!record || typeof record !== "object") {
    return record;
  }

  function cleanVal(v: unknown): unknown {
    if (typeof v === "string") {
      return sanitizeStringSecrets(v);
    }
    if (Array.isArray(v)) {
      return v.map((item) => cleanVal(item));
    }
    if (isRecord(v)) {
      return Object.fromEntries(
        Object.entries(v).map(([key, child]) => [key, cleanVal(child)]),
      );
    }
    return v;
  }

  return Object.fromEntries(
    Object.entries(record).map(([k, v]) => [k, cleanVal(v)]),
  ) as T;
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
    let sanitized = sanitizeStringSecrets(value);
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
