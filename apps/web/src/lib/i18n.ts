import { resolveMessage, type MessageKey } from "@lcsp/i18n";

import { appLocale } from "./locale";

export function resolveAppMessage(key: MessageKey) {
  return resolveMessage(appLocale, key);
}
