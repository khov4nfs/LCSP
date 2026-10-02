import type { MessageKey } from "@lcsp/i18n";

import type { ProviderCredentialStatus } from "@/lib/api/github-repository-client";

export type SettingsAlertMessage = {
  titleKey: MessageKey;
  detailKey: MessageKey;
};

export type RepositoriesSettingsSectionProps = {
  providerCredentialStatuses?: ProviderCredentialStatus[];
  onReauthenticate?: (retry: () => void) => void;
};
