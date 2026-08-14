import { createHash } from "node:crypto";

import type { AssessmentRuntimeSummaryValue } from "@lcsp/contracts/evidence";

const FALLBACK_SUMMARY = "Summary unavailable due to privacy policy";

const FORBIDDEN_KEY_PATTERN =
  /(^|[_-])(prompt|source|secret|token|api[_-]?key|authorization|password|ast|raw|content|payload|response|command|shell)([_-]|$)/i;
const SECRET_VALUE_PATTERN =
  /(bearer\s+[a-z0-9._-]+|-----begin [a-z ]*private key-----|sk-[a-z0-9]{16,}|gh[pousr]_[a-z0-9]{20,}|AIza[0-9A-Za-z\\-_]{20,})/i;

type SummaryOptions = {
  maxDepth?: number;
  maxItems?: number;
  maxStringLength?: number;
};

export function sanitizeRuntimeSummaryText(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return FALLBACK_SUMMARY;
  }
  if (looksUnsafeValue(value)) {
    return FALLBACK_SUMMARY;
  }
  return truncate(value.trim(), 240);
}

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
    if (looksUnsafeValue(value)) {
      return maskedValue(value);
    }
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
    return { redacted: "max_depth" };
  }

  const sanitized: Record<string, AssessmentRuntimeSummaryValue> = {};
  for (const [rawKey, nestedValue] of Object.entries(value).slice(
    0,
    options.maxItems,
  )) {
    if (FORBIDDEN_KEY_PATTERN.test(rawKey)) {
      sanitized[rawKey] = "[REDACTED]";
      continue;
    }
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

function looksUnsafeValue(value: string): boolean {
  return SECRET_VALUE_PATTERN.test(value) || value.length > 1_000;
}

function maskedValue(value: string): string {
  return `[REDACTED:${createHash("sha256").update(value).digest("hex").slice(0, 12)}]`;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export { FALLBACK_SUMMARY };
