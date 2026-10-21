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
  let text = resolveMessage(activeLocale, `${PREFIX}${key}` as MessageKey);
  for (const [name, value] of Object.entries(values))
    text = text.replaceAll(`{${name}}`, String(value));
  return text;
}
