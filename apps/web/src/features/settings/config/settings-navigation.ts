import type { MessageKey } from "@lcsp/i18n";

import {
  SETTINGS_SECTION_IDS,
  type SettingsSectionId,
} from "../types/settings.types";

export type SettingsNavigationItem = {
  id: SettingsSectionId;
  labelKey: MessageKey;
};

export const settingsNavigationItems: SettingsNavigationItem[] = [
  {
    id: SETTINGS_SECTION_IDS.general,
    labelKey: "pages.workspace.settingsHub.sections.general",
  },
  {
    id: SETTINGS_SECTION_IDS.account,
    labelKey: "pages.workspace.settingsHub.sections.account",
  },
  {
    id: SETTINGS_SECTION_IDS.privacy,
    labelKey: "pages.workspace.settingsHub.sections.privacy",
  },
  {
    id: SETTINGS_SECTION_IDS.billing,
    labelKey: "pages.workspace.settingsHub.sections.billing",
  },
  {
    id: SETTINGS_SECTION_IDS.usage,
    labelKey: "pages.workspace.settingsHub.sections.usage",
  },
  {
    id: SETTINGS_SECTION_IDS.capabilities,
    labelKey: "pages.workspace.settingsHub.sections.capabilities",
  },
  {
    id: SETTINGS_SECTION_IDS.connectors,
    labelKey: "pages.workspace.settingsHub.sections.connectors",
  },
];
