export const SETTINGS_SECTION_IDS = {
  general: "general",
  account: "account",
  privacy: "privacy",
  billing: "billing",
  usage: "usage",
  capabilities: "capabilities",
  connectors: "connectors",
} as const;

export type SettingsSectionId =
  (typeof SETTINGS_SECTION_IDS)[keyof typeof SETTINGS_SECTION_IDS];

export const LEGACY_SETTINGS_SECTION_IDS = {
  appearance: "appearance",
  notifications: "notifications",
  emails: "emails",
  passwordAndAuthentication: "password-and-authentication",
  sessions: "sessions",
  repositories: "repositories",
} as const;

export type LegacySettingsSectionId =
  (typeof LEGACY_SETTINGS_SECTION_IDS)[keyof typeof LEGACY_SETTINGS_SECTION_IDS];
