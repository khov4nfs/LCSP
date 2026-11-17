import { RESPONSE_LANGUAGES, type Locale } from "@lcsp/contracts/shared";
import {
  LEGACY_SETTINGS_SECTION_IDS,
  SETTINGS_SECTION_IDS,
  type SettingsSectionId,
} from "../types/settings.types";

/**
 * Business purpose: Present Settings timestamps using the selected application language.
 * Business rules:
 * - Missing or invalid timestamps show a neutral dash; English and Vietnamese use their locale conventions.
 * Execution flow:
 * 1. Validate the date, choose the language's date locale, and format date and time.
 * Failure cases:
 * - Invalid dates return a dash rather than throwing during render.
 * Side effects:
 * - Pure display formatting using the browser timezone.
 */
export function formatDateTime(
  value?: string | null,
  locale: Locale = RESPONSE_LANGUAGES.en,
) {
  if (!value || !Number.isFinite(new Date(value).getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat(
    locale === RESPONSE_LANGUAGES.vi ? "vi-VN" : "en-US",
    {
      dateStyle: "medium",
      timeStyle: "short",
    },
  ).format(new Date(value));
}

/**
 * Business purpose: Recognize supported Settings sections before choosing the displayed panel.
 * Business rules:
 * - Only the configured section identifiers are accepted; missing values are unsupported.
 * Execution flow:
 * 1. Reject null and compare the value with the canonical Settings section list.
 * Failure cases:
 * - Unrecognized values return false so routing can choose its existing fallback.
 * Side effects:
 * - Pure membership check without navigation or persistence.
 */
export function isSettingsSectionId(
  value: string | null,
): value is SettingsSectionId {
  return (
    value !== null &&
    (Object.values(SETTINGS_SECTION_IDS) as string[]).includes(value)
  );
}

export function normalizeSettingsSection(
  value: string | null,
): SettingsSectionId {
  if (isSettingsSectionId(value)) {
    return value;
  }

  switch (value) {
    case LEGACY_SETTINGS_SECTION_IDS.appearance:
    case LEGACY_SETTINGS_SECTION_IDS.notifications:
      return SETTINGS_SECTION_IDS.general;
    case LEGACY_SETTINGS_SECTION_IDS.emails:
    case LEGACY_SETTINGS_SECTION_IDS.passwordAndAuthentication:
    case LEGACY_SETTINGS_SECTION_IDS.sessions:
    case SETTINGS_SECTION_IDS.account:
      return SETTINGS_SECTION_IDS.account;
    case LEGACY_SETTINGS_SECTION_IDS.repositories:
      return SETTINGS_SECTION_IDS.connectors;
    default:
      return SETTINGS_SECTION_IDS.general;
  }
}
