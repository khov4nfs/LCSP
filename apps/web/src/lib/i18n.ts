import { resolveMessage, type MessageKey } from "@lcsp/i18n";

import { appLocale } from "./locale";

export function resolveAppMessage(key: MessageKey) {
  return resolveMessage(appLocale, key);
}

export function formatAppMessage(
  key: MessageKey,
  values: Record<string, string | number>,
) {
  return Object.entries(values).reduce(
    (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
    resolveMessage(appLocale, key),
  );
}
