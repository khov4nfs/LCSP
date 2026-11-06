import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import type { Locale } from "@lcsp/contracts/shared";
import { getAppLocaleSnapshot } from "@/lib/locale";

const PREFIX = "pages.assessmentConversation.";

/**
 * Business purpose: Present assessment conversation and report labels in the active customer locale.
 *
 * Business rules:
 * - Prefer the conversation message namespace and fall back to its report namespace only when the first key is unresolved.
 * - Interpolate caller-provided values as display text and never treat them as message keys.
 *
 * Execution flow:
 * 1. Select the explicit locale or the current application locale.
 * 2. Resolve the conversation key and, when absent, the report-specific key.
 * 3. Replace named placeholders and return the localized copy.
 *
 * Failure cases:
 * - Unrecognized keys use the i18n resolver's unresolved key behavior; missing interpolation values remain visible as placeholders.
 *
 * Side effects:
 * - None: reads the locale catalog and returns a string without changing assessment state.
 */
export function copy(
  key: string,
  values: Record<string, string | number> = {},
  locale?: Locale,
): string {
  const activeLocale = locale ?? getAppLocaleSnapshot();
  const conversationKey = `${PREFIX}${key}` as MessageKey;
  let text = resolveMessage(activeLocale, conversationKey);
  // Report pages share this helper with the conversation surface, but their
  // messages live under pages.assessmentConversation.report. Fall back only
  // when the conversation namespace does not contain the key.
  if (text === conversationKey) {
    text = resolveMessage(activeLocale, `${PREFIX}report.${key}` as MessageKey);
  }
  for (const [name, value] of Object.entries(values))
    text = text.replaceAll(`{${name}}`, String(value));
  return text;
}
