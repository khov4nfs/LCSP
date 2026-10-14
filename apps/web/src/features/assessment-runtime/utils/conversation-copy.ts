import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import type { Locale } from "@lcsp/contracts/shared";
import { getAppLocaleSnapshot } from "@/lib/locale";

const PREFIX = "pages.assessmentConversation.";

/** Resolves one `pages.assessmentConversation.*` message and fills its `{name}` placeholders. */
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
