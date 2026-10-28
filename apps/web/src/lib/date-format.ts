import type { Locale } from "@lcsp/contracts/shared";
import { appLocale } from "@/lib/locale";

/**
 * Formats a date using the active or provided locale
 * (e.g., "Oct 14, 2026" in EN, "14 thg 10, 2026" in VI).
 */
export function formatLocaleDate(
  isoString: string | null | undefined,
  locale?: Locale,
): string {
  if (!isoString) return "—";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale ?? appLocale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

/**
 * Formats date and time with month, day, hour, minute using locale authority
 * (e.g., "Oct 14, 02:00" in EN, "14 thg 10, 02:00" in VI).
 */
export function formatLocaleDateTime(
  isoString: string | null | undefined,
  locale?: Locale,
): string {
  if (!isoString) return "—";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale ?? appLocale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * Business purpose: Show a complete localized event timestamp with year for customer and Admin views.
 * Business rules:
 * - An explicit locale overrides the active locale; missing or invalid timestamps use the unavailable marker.
 * Execution flow:
 * 1. Reject absent or invalid input, then format valid time with the chosen locale.
 * Failure cases:
 * - Missing and unparsable timestamps return the same unavailable marker.
 * Side effects:
 * - None: formats a supplied value without changing persisted or UI state.
 */
export function formatLocaleDateTimeWithYear(
  isoString: string | null | undefined,
  locale?: Locale,
): string {
  if (!isoString) return "â€”";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "â€”";
  return new Intl.DateTimeFormat(locale ?? appLocale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/**
 * Formats activity time using locale authority
 * (e.g., "10/14, 02:00" in EN, localized month/day/time in VI).
 */
export function formatLocaleActivityTime(
  isoString: string | null | undefined,
  locale?: Locale,
): string {
  if (!isoString) return "—";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return typeof isoString === "string" ? isoString : "—";
  }
  return new Intl.DateTimeFormat(locale ?? appLocale, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}
