import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import { appLocale } from "@/lib/locale";
import { formatLocaleDateTimeWithYear } from "@/lib/date-format";

export function trackingMessage(suffix: string) {
  return resolveMessage(
    appLocale,
    `pages.workspace.tracking.${suffix}` as MessageKey,
  );
}

export function formatTrackingDate(value: string | null | undefined) {
  return formatLocaleDateTimeWithYear(value);
}
