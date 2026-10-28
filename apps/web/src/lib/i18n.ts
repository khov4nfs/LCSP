import { resolveMessage, type MessageKey } from "@lcsp/i18n";

import { appLocale } from "./locale";

export function resolveAppMessage(key: MessageKey) {
  return resolveMessage(appLocale, key);
}

/**
 * Business purpose: Render a localized application message with supplied named placeholders.
 *
 * Business rules:
 * - Resolve the canonical message key in appLocale and replace matching literal placeholders
 *   with stringified values.
 *
 * Execution flow:
 * 1. Resolve the message and apply the supplied named replacements.
 *
 * Failure cases:
 * - Missing replacements remain in the resolved text; message-resolution failures follow the
 *   i18n resolver.
 *
 * Side effects:
 * - None: pure text formatting.
 */
export function formatAppMessage(
  key: MessageKey,
  values: Record<string, string | number>,
) {
  return Object.entries(values).reduce(
    (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
    resolveMessage(appLocale, key),
  );
}
