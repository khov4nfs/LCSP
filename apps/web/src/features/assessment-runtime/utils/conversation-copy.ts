import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import { appLocale } from "@/lib/locale";

const PREFIX = "pages.assessmentConversation.";

/** Resolves one `pages.assessmentConversation.*` message and fills its `{name}` placeholders. */
export function copy(
  key: string,
  values: Record<string, string | number> = {},
): string {
  let text = resolveMessage(appLocale, `${PREFIX}${key}` as MessageKey);
  for (const [name, value] of Object.entries(values))
    text = text.replaceAll(`{${name}}`, String(value));
  return text;
}
