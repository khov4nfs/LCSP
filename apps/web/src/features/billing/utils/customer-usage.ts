import { customerUsageQuerySchema } from "@lcsp/contracts/billing";
import type { Locale } from "@lcsp/contracts/shared";

import { CUSTOMER_USAGE_PAGE_SIZE } from "../config/customer-usage.config";

/**
 * Business purpose: Select a fixed inclusive UTC-day window for the customer's usage report.
 * Business rules:
 * - Include today and the preceding days; keep absolute timestamps in the cache key rather than a rolling label.
 * Execution flow:
 * 1. Anchor at today's UTC midnight and validate the requested window with the customer contract.
 * Failure cases:
 * - Invalid dates or periods outside the shared reporting bounds are rejected.
 * Side effects:
 * - Pure query construction; no billing or browser storage mutation.
 */
export function customerUsagePeriod(days = 30, now = new Date()) {
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return customerUsageQuerySchema.parse({
    from: new Date(today - (days - 1) * 86400000).toISOString(),
    to: new Date(today + 86400000 - 1).toISOString(),
    page: 1,
    pageSize: CUSTOMER_USAGE_PAGE_SIZE,
  });
}

/**
 * Business purpose: Display provider token counts without losing precision for large receipts.
 * Business rules:
 * - Counts are nonnegative integer strings; missing values remain unknown at the calling surface.
 * Execution flow:
 * 1. Convert the validated integer to BigInt and format it with the selected application locale.
 * Failure cases:
 * - Invalid count strings throw; successful API payloads must pass the shared schema first.
 * Side effects:
 * - Pure localized display formatting.
 */
export function formatUsageCount(value: string | number, locale: Locale) {
  return new Intl.NumberFormat(locale).format(BigInt(value));
}

/**
 * Business purpose: Display usage receipt and refresh timestamps consistently in the active language.
 * Business rules:
 * - Timestamp display uses the browser timezone; reporting-day boundaries remain UTC.
 * Execution flow:
 * 1. Format the validated timestamp with the locale's medium date and short time convention.
 * Failure cases:
 * - Invalid timestamps reject formatting; report timestamps must pass contract validation first.
 * Side effects:
 * - Pure presentation formatting with no storage or request effects.
 */
export function formatUsageDateTime(
  value: string | number,
  locale: Locale,
): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
