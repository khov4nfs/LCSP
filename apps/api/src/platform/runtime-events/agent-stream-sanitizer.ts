import type { AssessmentRuntimeSummaryValue } from "@lcsp/contracts/evidence";

import { isRecord } from "../../common/utils/index.js";

const MAX_AGENT_STREAM_TEXT_LENGTH = 65_536;
const MAX_AGENT_STREAM_DEPTH = 8;
const MAX_AGENT_STREAM_ITEMS = 100;
const REDACTED_VALUE = "[REDACTED]";

const SENSITIVE_KEY_PATTERN =
  /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|credential|client[_-]?secret|password|passwd|private[_-]?key|secret)/i;

const SENSITIVE_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/gi,
  /\bsk-ant-[A-Za-z0-9._-]+\b/gi,
  /\bsk_(?:live|test)_[A-Za-z0-9_-]{12,}\b/gi,
  /((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:\s/@]+:)[^@\s/]+@/gi,
  /((?:["']?)(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|credential|client[_-]?secret)(?:["']?)\s*[:=]\s*)[^\s,;}]+/gi,
] as const;

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

/** Recursively redact structured live-stream payloads without collapsing useful tool output. */
export function sanitizeAgentStreamValue(
  value: unknown,
  depth = 0,
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
      .filter((item): item is AssessmentRuntimeSummaryValue => item !== null);
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
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = REDACTED_VALUE;
      continue;
    }
    const sanitized = sanitizeAgentStreamValue(nested, depth + 1);
    if (sanitized !== null) output[key] = sanitized;
  }
  return output;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

export { MAX_AGENT_STREAM_TEXT_LENGTH };
