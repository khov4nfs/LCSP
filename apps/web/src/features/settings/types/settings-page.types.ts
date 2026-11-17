import type { MessageKey } from "@lcsp/i18n";

import type { ProviderCredentialStatus } from "@/lib/api/github-repository-client";
import {
  SETTINGS_PRESENTATIONS,
  SETTINGS_SENSITIVE_ACTIONS,
} from "../config/settings-page.config";
import type { SettingsSectionId } from "./settings.types";

export type SettingsPageProps = {
  activeSection?: SettingsSectionId;
  onSectionChange?: (section: SettingsSectionId) => void;
  presentation?: (typeof SETTINGS_PRESENTATIONS)[keyof typeof SETTINGS_PRESENTATIONS];
};

export type SettingsSensitiveAction = {
  resolveResult?: (success: boolean) => void;
} & (
  | {
      kind: typeof SETTINGS_SENSITIVE_ACTIONS.reauthenticateProviderCredential;
      retry: () => void;
    }
  | {
      kind: typeof SETTINGS_SENSITIVE_ACTIONS.reauthenticateSettings;
      mfaRequired: boolean;
    }
);

export type SettingsAlertMessage = {
  titleKey: MessageKey;
  detailKey: MessageKey;
};

export type RepositoriesSettingsSectionProps = {
  providerCredentialStatuses?: ProviderCredentialStatus[];
  onReauthenticate?: (retry: () => void) => void;
};
