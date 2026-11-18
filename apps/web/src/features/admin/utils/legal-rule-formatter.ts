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
