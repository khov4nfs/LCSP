import { headers } from "next/headers";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import { LOCALES, type Locale } from "@lcsp/contracts/shared";
import type { Metadata } from "next";

/**
 * Business purpose: Keep Authentication document metadata in the same language as the current server-rendered page.
 * Business rules:
 * - Only a locale forwarded by the request Proxy and present in the shared locale set is accepted; unsupported or missing values use English.
 * - Metadata keys must come from the shared typed translation catalog.
 * Execution flow:
 * 1. Read the request-scoped locale header.
 * 2. Validate it against the canonical locale set, falling back to English when invalid.
 * 3. Resolve the page title and description from the selected translation catalog.
 * Failure cases:
 * - Missing or unsupported locale headers cannot select an arbitrary dictionary and use the established English fallback.
 * Side effects:
 * - Reads request headers and returns metadata; it does not mutate locale state, cookies, sessions or authentication data.
 */
export async function getAuthPageMetadata(
  titleKey: MessageKey,
  descriptionKey: MessageKey,
): Promise<Metadata> {
  const requestedLocale = (await headers()).get("x-lcsp-locale");
  const locale: Locale = LOCALES.includes(requestedLocale as Locale)
    ? (requestedLocale as Locale)
    : "en";

  return {
    title: resolveMessage(locale, titleKey),
    description: resolveMessage(locale, descriptionKey),
  };
}
