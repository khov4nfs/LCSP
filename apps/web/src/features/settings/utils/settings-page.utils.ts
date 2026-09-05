import {
  LEGACY_SETTINGS_SECTION_IDS,
  SETTINGS_SECTION_IDS,
  type SettingsSectionId,
} from "../types/settings.types";

export function formatDateTime(value?: string | null) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function isSettingsSectionId(value: string | null): value is SettingsSectionId {
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
