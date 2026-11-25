import type { MessageKey } from "@lcsp/i18n";

import {
  SETTINGS_SECTION_IDS,
  type SettingsSectionId,
} from "../types/settings.types";

export type SettingsNavigationItem = {
  id: SettingsSectionId;
  labelKey: MessageKey;
  keywords: string[];
};

export const settingsNavigationItems: SettingsNavigationItem[] = [
  {
    id: SETTINGS_SECTION_IDS.general,
    labelKey: "pages.workspace.settingsHub.sections.general",
    keywords: ["profile", "appearance", "theme", "language", "font", "notifications"],
  },
  {
    id: SETTINGS_SECTION_IDS.account,
    labelKey: "pages.workspace.settingsHub.sections.account",
    keywords: ["email", "password", "mfa", "authenticator", "sessions", "oauth", "recovery"],
  },
  {
    id: SETTINGS_SECTION_IDS.privacy,
    labelKey: "pages.workspace.settingsHub.sections.privacy",
    keywords: ["telemetry", "export", "retention", "models", "data"],
  },
  {
    id: SETTINGS_SECTION_IDS.billing,
    labelKey: "pages.workspace.settingsHub.sections.billing",
    keywords: ["plan", "payment", "invoice", "subscription", "balance"],
  },
  {
    id: SETTINGS_SECTION_IDS.usage,
    labelKey: "pages.workspace.settingsHub.sections.usage",
    keywords: ["credits", "tokens", "consumption", "quota", "metrics"],
  },
  {
    id: SETTINGS_SECTION_IDS.capabilities,
    labelKey: "pages.workspace.settingsHub.sections.capabilities",
    keywords: ["tools", "artifacts", "connector search", "sandbox", "network", "allowlist"],
  },
  {
    id: SETTINGS_SECTION_IDS.connectors,
    labelKey: "pages.workspace.settingsHub.sections.connectors",
    keywords: ["github", "git", "pat", "token", "repositories", "provider"],
  },
];
