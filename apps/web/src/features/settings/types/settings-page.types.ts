import type { MessageKey } from "@lcsp/i18n";

import type { ProviderCredentialStatus } from "@/lib/api/github-repository-client";
import {
  SETTINGS_PRESENTATIONS,
  SETTINGS_SENSITIVE_ACTIONS,
} from "../config/settings-page.config";
import type { ProviderReauthenticateHandler } from "./provider-credential.types";
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
  /** Distinguishes an unfinished load from an empty result. */
  isLoading?: boolean;
  /** True when statuses could not be read; the connection state is then unknown, not empty. */
  loadFailed?: boolean;
  onRetry?: () => void;
  onReauthenticate?: ProviderReauthenticateHandler;
};
