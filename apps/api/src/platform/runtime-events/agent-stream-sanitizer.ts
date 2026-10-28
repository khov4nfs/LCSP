import type { AssessmentRuntimeSummaryValue } from "@lcsp/contracts/evidence";

import { isRecord } from "@lcsp/contracts/shared";

const MAX_AGENT_STREAM_TEXT_LENGTH = 65_536;
const MAX_AGENT_STREAM_DEPTH = 8;
const MAX_AGENT_STREAM_ITEMS = 100;
const REDACTED_VALUE = "[REDACTED]";

const SENSITIVE_KEY_PATTERN =
  /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|authorization|credential|client[_-]?secret|password|passwd|private[_-]?key|secret)/i;
const SAFE_AGENT_STREAM_KEY_NAMES = new Set([
  "credentialslotsafeid",
  "inputtokens",
  "outputtokens",
  "totaltokens",
  "tokencount",
  "usage",
  "usagemetadata",
]);
const SENSITIVE_AGENT_STREAM_KEY_NAMES = new Set(["rawerrorbody"]);
const PRIVATE_RUNTIME_KEY_NAMES = new Set([
  "messages",
  "prompt",
  "systemprompt",
  "developerprompt",
  "instruction",
  "privatecontext",
  "customercontext",
  "confirmedcontext",
  "confirmedcustomercontext",
  "prioranswerhistory",
  "scratchpad",
  "reasoning",
  "hiddenreasoning",
  "chainofthought",
  "thought",
  "thoughts",
]);

const SENSITIVE_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/gi,
  /\bsk-ant-[A-Za-z0-9._-]+\b/gi,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/gi,
  /\bhf_[A-Za-z0-9]{20,}\b/gi,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\bsk_(?:live|test)_[A-Za-z0-9_-]{12,}\b/gi,
  /((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:\s/@]+:)[^@\s/]+@/gi,
  /((?:["']?)(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|credential|client[_-]?secret)(?:["']?)\s*[:=]\s*)[^\s,;}]+/gi,
] as const;

const PRIVATE_RUNTIME_VALUE = "[HIDDEN_PRIVATE_RUNTIME_STATE]";

export function containsSensitiveCredentialText(value: string): boolean {
  if (SENSITIVE_KEY_PATTERN.test(value) || /\bBasic\s+\S+/i.test(value)) {
    return true;
  }
  return SENSITIVE_VALUE_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

/** Preserve streaming whitespace while removing credential material and bounding one event. */
export function sanitizeAgentStreamText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let sanitized = value;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    pattern.lastIndex = 0;
    sanitized = sanitized.replace(pattern, (match, prefix?: string) =>
      typeof prefix === "string" && prefix.length > 0
        ? `${prefix}${REDACTED_VALUE}${match.endsWith("@") ? "@" : ""}`
        : REDACTED_VALUE,
    );
  }
  return truncate(sanitized, MAX_AGENT_STREAM_TEXT_LENGTH);
}

/** Sanitize identifiers/labels that should not preserve leading/trailing whitespace. */
export function sanitizeAgentStreamIdentifier(value: unknown): string | null {
  const sanitized = sanitizeAgentStreamText(value);
  if (sanitized === null) return null;
  const trimmed = sanitized.trim();
  return trimmed.length > 0 ? truncate(trimmed, 512) : null;
}

const USAGE_METRIC_KEY = /^[a-z][a-z0-9_]{0,47}$/;

/**
 * Business purpose: Redact structured runtime and provenance payloads while preserving their
 * valid JSON values, including explicit null fields required by canonical event contracts.
 *
 * Business rules:
 * - Credentials and private runtime state remain hidden; only trusted usage counters are exempt.
 * - Explicit null values retain their fields and array positions; unsupported values are omitted.
 * - Text length, collection size and nesting limits continue to bound exposed payloads.
 *
 * Execution flow:
 * 1. Preserve JSON primitives and sanitize text.
 * 2. Recursively sanitize bounded arrays and records without dropping explicit null values.
 * 3. Redact sensitive keys and private runtime state before returning the safe projection.
 *
 * Failure cases:
 * - Unsupported values return null and are omitted from containing collections.
 * - Excessive nesting returns a truncation marker instead of traversing private state further.
 *
 * Side effects:
 * - Pure projection; never mutates the supplied payload or persisted assessment records.
 */
export function sanitizeAgentStreamValue(
  value: unknown,
  depth = 0,
  inUsage = false,
  // Provider usage counters are trusted only on the model-call completion event; any
  // other event's `usage` key is graph/tool-authored data and stays fully redacted.
  allowUsage = true,
): AssessmentRuntimeSummaryValue | null {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (typeof value === "string") {
    return sanitizeAgentStreamText(value);
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_AGENT_STREAM_DEPTH) {
      return { truncated: "max_depth" };
    }
    return value
      .slice(0, MAX_AGENT_STREAM_ITEMS)
      .map((item) => sanitizeAgentStreamValue(item, depth + 1))
      .filter((item, index) => item !== null || value[index] === null);
  }
  if (!isRecord(value)) return null;
  if (depth >= MAX_AGENT_STREAM_DEPTH) {
    return { truncated: "max_depth" };
  }

  const output: Record<string, AssessmentRuntimeSummaryValue> = {};
  for (const [key, nested] of Object.entries(value).slice(
    0,
    MAX_AGENT_STREAM_ITEMS,
  )) {
    // Provider usage counters (reasoning_tokens, cached_tokens, ...) are plain
    // numbers: they cannot carry a secret or reasoning text, so keep them.
    if (inUsage && typeof nested === "number" && USAGE_METRIC_KEY.test(key)) {
      output[key] = nested;
      continue;
    }
    if (PRIVATE_RUNTIME_KEY_NAMES.has(normalizeKey(key))) {
      output[key] = PRIVATE_RUNTIME_VALUE;
      continue;
    }
    const normalizedKey = normalizeKey(key);
    if (
      SENSITIVE_AGENT_STREAM_KEY_NAMES.has(normalizedKey) ||
      (!SAFE_AGENT_STREAM_KEY_NAMES.has(normalizedKey) &&
        SENSITIVE_KEY_PATTERN.test(key))
    ) {
      output[key] = REDACTED_VALUE;
      continue;
    }
    const sanitized = sanitizeAgentStreamValue(
      nested,
      depth + 1,
      inUsage || (allowUsage && depth === 0 && key === "usage"),
    );
    if (sanitized !== null || nested === null) output[key] = sanitized;
  }
  return output;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export { MAX_AGENT_STREAM_TEXT_LENGTH };
