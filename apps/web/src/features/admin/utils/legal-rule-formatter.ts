import { AGENT_EXECUTION_STATES } from "@lcsp/contracts";
import { LEGAL_RULE_PREPARATION_STATES } from "@lcsp/contracts/legal-rule-catalog";

/**
 * Utilities for formatting legal provisions, locators, and titles for UI display.
 */

/**
 * Business purpose: Determine whether an identifier string is a technical hash or machine identifier that should be hidden from end-user UI.
 * Business rules:
 * - Raw hashes (SHA, MD5), UUIDs, and synthetic source-chunk prefixes (such as `src-`) are technical fingerprints and must not be presented as user-facing legal rule codes.
 * Execution flow:
 * 1. Trim input string; return false if empty or nullish.
 * 2. Test against synthetic chunk prefix pattern (`src-[hex]`).
 * 3. Test against standard UUID v4/v5 hyphenated hex pattern.
 * 4. Test against unbroken hexadecimal string of 16 or more characters.
 * 5. Test against explicit hash algorithm prefixes (`sha256:`, `sha1:`, `md5:`).
 * Failure cases:
 * - Null, undefined, empty, or whitespace-only strings return false safely.
 * Side effects:
 * - Pure function; no state mutations or external side effects.
 */
export function isIdOrSha(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (/^src-[0-9a-fA-F]{8,}/i.test(trimmed)) return true;
  if (
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i.test(
      trimmed,
    )
  ) {
    return true;
  }
  if (/^[0-9a-fA-F]{16,}$/.test(trimmed)) return true;
  if (/^(?:sha256|sha1|md5):[0-9a-fA-F]+/i.test(trimmed)) return true;
  return false;
}

/**
 * Business purpose: Translate machine-readable citation locators into human-readable Vietnamese legal hierarchy terms.
 * Business rules:
 * - Locator codes `art-{n}`, `cl-{n}`, and `pt-{x}` map directly to "Điều {n}", "Khoản {n}", and "Điểm {x}".
 * - Hierarchy separator `::` maps to comma separator `, `.
 * Execution flow:
 * 1. Return empty string if input is nullish.
 * 2. Replace `art-{number}` patterns with `Điều {number}`.
 * 3. Replace `cl-{number}` patterns with `Khoản {number}`.
 * 4. Replace `pt-{letter/number}` patterns with `Điểm {letter/number}`.
 * 5. Replace `::` delimiters with `, `.
 * Failure cases:
 * - Non-matching substrings or empty inputs are preserved safely without throwing exceptions.
 * Side effects:
 * - Pure function; no state mutations or external side effects.
 */
export function formatLocator(locator: string | null | undefined): string {
  if (!locator) return "";
  return locator
    .replace(/(?<![a-zA-Z0-9])art-(\d+)(?![a-zA-Z0-9])/g, "Điều $1")
    .replace(/(?<![a-zA-Z0-9])cl-(\d+)(?![a-zA-Z0-9])/g, "Khoản $1")
    .replace(/(?<![a-zA-Z0-9])pt-([a-zđA-ZĐ0-9]+)(?![a-zA-Z0-9])/gu, "Điểm $1")
    .replace(/::/g, ", ");
}

/**
 * Business purpose: Format a legal rule header for display, suppressing technical IDs/SHAs and humanizing locator titles.
 * Business rules:
 * - When `legalRuleId` is a technical SHA, chunk hash, or duplicate of the title, hide the ID and display only the humanized title.
 * - When it is a meaningful business code, display `{code} · {title}`.
 * Execution flow:
 * 1. Format the title using `formatLocator`.
 * 2. If `legalRuleId` is absent, matches `isIdOrSha`, or is identical to the title, return only the formatted title.
 * 3. Otherwise return `${rule.legalRuleId} · ${formattedTitle}`.
 * Failure cases:
 * - Missing title returns an empty string or the raw ID if non-hash.
 * Side effects:
 * - Pure function; no state mutations or external side effects.
 */
export function getRuleDisplayTitle(rule: {
  legalRuleId?: string | null;
  title: string;
}): string {
  const formattedTitle = formatLocator(rule.title);
  if (!rule.legalRuleId || isIdOrSha(rule.legalRuleId) || rule.legalRuleId === rule.title) {
    return formattedTitle;
  }
  return `${rule.legalRuleId} · ${formattedTitle}`;
}

/**
 * Business purpose: Break condensed legal provision text into distinct paragraphs for Articles (Điều), Clauses (Khoản), and Points (Điểm).
 * Business rules:
 * - Articles ("Điều X.") and explicit clauses ("Khoản X.") must start on a new paragraph.
 * - Numbered clauses ("1. ", "2. ") must start on a new paragraph unless immediately preceded by "Điều" or "Khoản" (e.g. "Điều 6.").
 * - Explicit points ("Điểm a)") and lettered points ("a) ", "b) ", "đ) ") must start on a new paragraph.
 * - Existing spacing and punctuation must be preserved; excessive consecutive newlines are normalized to double newlines.
 * Execution flow:
 * 1. Trim input text; return empty string if nullish or empty.
 * 2. Insert paragraph breaks before "Điều \d+".
 * 3. Insert paragraph breaks before "Khoản \d+".
 * 4. Insert paragraph breaks before numbered clauses `\d+\.\s+[A-ZÀ-ỸĐ]`, guarding against article numbers via backward context check.
 * 5. Insert paragraph breaks before explicit "Điểm [a-zđ0-9]+".
 * 6. Insert paragraph breaks before lettered points `[a-zđ]\)\s+`.
 * 7. Collapse three or more consecutive newlines into double newlines and trim.
 * Failure cases:
 * - Malformed, empty, or unformatted text is returned safely without modification.
 * Side effects:
 * - Pure function; no state mutations or external side effects.
 */
export function formatLegalProvisions(text: string | null | undefined): string {
  if (!text) return "";
  let formatted = text.trim();

  // 1. Break before "Điều X." or "Điều X:" or "Điều X "
  formatted = formatted.replace(/(?<!^|\n)\s*(?=Điều\s+\d+[.:\s])/gu, "\n\n");

  // 2. Break before explicit "Khoản X." or "Khoản X:"
  formatted = formatted.replace(/(?<!^|\n)\s*(?=Khoản\s+\d+[.:\s])/gu, "\n\n");

  // 3. Break before numbered clause: "1. ", "2. ", only when NOT preceded by "Điều" or "Khoản"
  formatted = formatted.replace(
    /(?<=[^\s])\s+(?=\d+\.\s+[A-ZÀ-ỸĐ])/gu,
    (match, offset, str) => {
      const before = str.slice(0, offset);
      if (/(?:Điều|Khoản)\s*$/i.test(before)) {
        return match;
      }
      return "\n\n";
    },
  );

  // 4. Break before explicit "Điểm [a-zđ]"
  formatted = formatted.replace(
    /(?<!^|\n)\s*(?=Điểm\s+[a-zđ0-9]+[.:\)\s])/giu,
    "\n\n",
  );

  // 5. Break before lettered point: "a) ", "b) ", "c) ", "d) ", "đ) ", "e) ", etc.
  formatted = formatted.replace(/(?<!^|\n)\s+(?=[a-zđ]\)\s+)/giu, "\n\n");

  // Clean up any extra empty lines (> 2 newlines)
  return formatted.replace(/\n{3,}/g, "\n\n").trim();
}

export interface PreparationFailureDetails {
  title: string;
  description: string;
  guidance?: string;
  technicalCode?: string | null;
  provider?: string | null;
  model?: string | null;
  errorClass?: string | null;
}

interface ResolveFailureInput {
  failureCode?: string | null;
  executionState?: string | null;
  events?: Array<{
    eventType: string;
    data?: unknown;
  }>;
  t: (key: string) => string;
}

/**
 * Business purpose: Resolve structured, human-readable failure diagnostics from preparation run telemetry and failure codes.
 * Business rules:
 * - Technical failure codes (such as SELECTED_RULE_PREPARATION_FAILED) must be translated into actionable, localized diagnostic explanations.
 * - Root-cause provider errors (such as TerminalCredentialError, AnthropicConnectionError, RateLimitError) must be surfaced when visible in stream telemetry.
 * - Provides clear next-step remediation guidance to help operators unblock preparation failures.
 * Execution flow:
 * 1. Return null if execution is not in a failed state and no failure code is recorded.
 * 2. Scan activity events in reverse chronological order for explicit failure events (MODEL_CALL_FAILED, CUSTOM_PROGRESS, BOUNDARY_FAILED).
 * 3. Extract provider, model, error type, and underlying error class metadata.
 * 4. Match against known failure categories: authentication/credentials, network connectivity, rate limits/quotas, model timeouts, structured output schema errors, or budget exhaustion.
 * 5. Fall back to domain failure code mappings or generic failure messages when specific event payloads are absent.
 * 6. Return structured diagnostic object with localized title, description, guidance, and technical metadata.
 * Failure cases:
 * - Missing or malformed event payloads gracefully fall back to domain failure codes or general failure messages.
 * Side effects:
 * - Pure function; no external state modifications.
 */
export function resolvePreparationFailureDetails({
  failureCode,
  executionState,
  events,
  t,
}: ResolveFailureInput): PreparationFailureDetails | null {
  const isFailed =
    executionState === AGENT_EXECUTION_STATES.FAILED ||
    executionState === LEGAL_RULE_PREPARATION_STATES.FAILED ||
    Boolean(failureCode);
  if (!isFailed) return null;

  let provider: string | null = null;
  let model: string | null = null;
  let errorType: string | null = null;
  let errorClass: string | null = null;
  let providerErrorCode: string | number | null = null;

  if (Array.isArray(events)) {
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (!ev) continue;
      const data =
        ev.data && typeof ev.data === "object"
          ? (ev.data as Record<string, unknown>)
          : null;

      if (!provider && data?.provider && typeof data.provider === "string") {
        provider = data.provider;
      }
      if (!model && data?.model && typeof data.model === "string") {
        model = data.model;
      }

      if (
        ev.eventType === "MODEL_CALL_FAILED" ||
        ev.eventType === "BOUNDARY_FAILED" ||
        data?.activity_kind === "SELECTED_RULE_PREPARATION_FAILED"
      ) {
        if (!errorType && typeof data?.error_type === "string") {
          errorType = data.error_type;
        }
        if (
          !errorClass &&
          typeof data?.last_attempt_error_class === "string"
        ) {
          errorClass = data.last_attempt_error_class;
        }
        if (
          providerErrorCode === null &&
          (typeof data?.provider_error_code === "string" ||
            typeof data?.provider_error_code === "number")
        ) {
          providerErrorCode = data.provider_error_code;
        }
      }
    }
  }

  const effectiveCode = String(providerErrorCode ?? "");
  const effectiveError = `${errorType ?? ""} ${errorClass ?? ""}`;

  // 1. Credential / Authentication error (checked first as it indicates auth/config blockage)
  if (
    effectiveError.includes("TerminalCredentialError") ||
    effectiveError.includes("AuthenticationError") ||
    effectiveError.includes("PermissionDeniedError") ||
    effectiveCode === "401" ||
    effectiveCode === "403"
  ) {
    return {
      title: t("failureCredentialTitle"),
      description: t("failureCredentialDesc"),
      guidance: t("failureCredentialGuidance"),
      technicalCode: failureCode ?? undefined,
      provider,
      model,
      errorClass: errorClass ?? errorType ?? undefined,
    };
  }

  // 2. Connection / Network failure (e.g. AnthropicConnectionError)
  if (
    effectiveError.includes("ConnectionError") ||
    effectiveError.includes("APIConnectionError") ||
    effectiveError.includes("NetworkError")
  ) {
    return {
      title: t("failureConnectionTitle"),
      description: t("failureConnectionDesc"),
      guidance: t("failureConnectionGuidance"),
      technicalCode: failureCode ?? undefined,
      provider,
      model,
      errorClass: errorClass ?? errorType ?? undefined,
    };
  }

  // 3. Rate Limit / Quota Exceeded
  if (
    effectiveError.includes("RateLimitError") ||
    effectiveCode === "429" ||
    failureCode === "TOKEN_LIMIT_EXCEEDED"
  ) {
    return {
      title: t("failureRateLimitTitle"),
      description: t("failureRateLimitDesc"),
      guidance: t("failureRateLimitGuidance"),
      technicalCode: failureCode ?? undefined,
      provider,
      model,
      errorClass: errorClass ?? errorType ?? undefined,
    };
  }

  // 4. Timeout
  if (
    effectiveError.includes("Timeout") ||
    failureCode === "MODEL_TIMEOUT"
  ) {
    return {
      title: t("failureTimeoutTitle"),
      description: t("failureTimeoutDesc"),
      guidance: t("failureTimeoutGuidance"),
      technicalCode: failureCode ?? undefined,
      provider,
      model,
      errorClass: errorClass ?? errorType ?? undefined,
    };
  }

  // 5. Schema / Structured output error
  if (
    effectiveError.includes("StructuredOutput") ||
    effectiveError.includes("TerminalSchema") ||
    effectiveError.includes("ValueError")
  ) {
    return {
      title: t("failureSchemaTitle"),
      description: t("failureSchemaDesc"),
      guidance: t("failureSchemaGuidance"),
      technicalCode: failureCode ?? undefined,
      provider,
      model,
      errorClass: errorClass ?? errorType ?? undefined,
    };
  }

  // 6. Agent Budget Exceeded
  if (
    effectiveError.includes("BudgetExceeded") ||
    failureCode === "AGENT_BUDGET_REACHED" ||
    failureCode === "CALL_LIMIT_EXCEEDED"
  ) {
    return {
      title: t("failureBudgetTitle"),
      description: t("failureBudgetDesc"),
      guidance: t("failureBudgetGuidance"),
      technicalCode: failureCode ?? undefined,
      provider,
      model,
      errorClass: errorClass ?? errorType ?? undefined,
    };
  }

  // 7. Source Ineligible
  if (
    failureCode === "LEGAL_RULE_SOURCE_INELIGIBLE" ||
    failureCode === "SOURCE_UNAVAILABLE"
  ) {
    return {
      title: t("failureSourceTitle"),
      description: t("failureSourceDesc"),
      guidance: t("failureSourceGuidance"),
      technicalCode: failureCode ?? undefined,
      provider,
      model,
      errorClass: errorClass ?? errorType ?? undefined,
    };
  }

  // 8. Citation Invalid
  if (failureCode === "CITATION_INVALID") {
    return {
      title: t("failureCitationTitle"),
      description: t("failureCitationDesc"),
      guidance: t("failureCitationGuidance"),
      technicalCode: failureCode ?? undefined,
      provider,
      model,
      errorClass: errorClass ?? errorType ?? undefined,
    };
  }

  // 9. Generic failure
  return {
    title: t("failureGenericTitle"),
    description: t("failureGenericDesc"),
    guidance: t("failureGenericGuidance"),
    technicalCode: failureCode ?? undefined,
    provider,
    model,
    errorClass: errorClass ?? errorType ?? undefined,
  };
}
