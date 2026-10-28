import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import { appLocale } from "@/lib/locale";
import { formatLocaleDateTimeWithYear } from "@/lib/date-format";

/**
 * Business purpose: Resolve tracking copy in the active application locale.
 * Business rules:
 * - The suffix must identify a tracking message key already present in the i18n catalog.
 * Execution flow:
 * 1. Prefix the tracking namespace and resolve the message for the current locale.
 * Failure cases:
 * - Missing catalog keys follow the shared i18n resolver's missing-key behavior.
 * Side effects:
 * - None: reads the active locale and catalog without changing application state.
 */
export function trackingMessage(suffix: string) {
  return resolveMessage(
    appLocale,
    `pages.workspace.tracking.${suffix}` as MessageKey,
  );
}

/**
 * Business purpose: Display tracking event time consistently with the workspace date format.
 * Business rules:
 * - Null or invalid timestamps use the shared date formatter's unavailable marker.
 * Execution flow:
 * 1. Delegate the timestamp to the locale-aware date and time formatter.
 * Failure cases:
 * - Invalid date values produce the shared unavailable marker instead of an invented date.
 * Side effects:
 * - None: returns display text without modifying tracking data.
 */
export function formatTrackingDate(value: string | null | undefined) {
  return formatLocaleDateTimeWithYear(value);
}
