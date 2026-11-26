"use client";

import {
  CREDENTIAL_PROVIDERS,
  type CredentialProvider,
} from "@lcsp/contracts/github-integration";
import { resolveMessage } from "@lcsp/i18n";
import { ShieldCheckIcon } from "lucide-react";
import Image from "next/image";
import { useId, useMemo, useState } from "react";

import { GIT_PROVIDER_LOGOS } from "@/components/molecules/git-provider-identity";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

import {
  PROVIDER_CONNECTION_LABEL_KEYS,
  PROVIDER_CONNECTION_TONE_CLASSES,
} from "../../config/provider-connection.config";
import type { RepositoriesSettingsSectionProps } from "../../types/settings-page.types";
import {
  getProviderConnectionState,
  hasProviderCredential,
} from "../../utils/provider-connection.utils";
import {
  PROVIDER_CREDENTIAL_DIALOG_MODES,
  ProviderCredentialDialog,
  type ProviderCredentialDialogMode,
} from "../molecules/provider-credential-dialog";

/**
 * Reuse canonical provider logos from `git-provider-identity` so M14 settings
 * and M02 repository setup share one Brand asset source.
 */
const CONNECTOR_PROVIDER_OPTIONS = [
  {
    id: CREDENTIAL_PROVIDERS.github,
    logo: GIT_PROVIDER_LOGOS.GITHUB,
    labelKey: "pages.workspace.settingsHub.repositories.githubProvider",
    supported: true,
  },
  {
    id: CREDENTIAL_PROVIDERS.gitlab,
    logo: GIT_PROVIDER_LOGOS.GITLAB,
    labelKey: "pages.workspace.settingsHub.repositories.gitlabProvider",
    supported: true,
  },
  {
    id: CREDENTIAL_PROVIDERS.bitbucket,
    logo: GIT_PROVIDER_LOGOS.BITBUCKET,
    labelKey: "pages.workspace.settingsHub.repositories.bitbucketProvider",
    supported: true,
  },
  {
    id: CREDENTIAL_PROVIDERS.azureDevOps,
    logo: GIT_PROVIDER_LOGOS.AZURE_DEVOPS,
    labelKey: "pages.workspace.settingsHub.repositories.azureDevOpsProvider",
    supported: true,
  },
] as const;

const SUPPORTED_CREDENTIAL_PROVIDERS = [
  CREDENTIAL_PROVIDERS.github,
  CREDENTIAL_PROVIDERS.gitlab,
  CREDENTIAL_PROVIDERS.bitbucket,
  CREDENTIAL_PROVIDERS.azureDevOps,
] as const;

type SupportedCredentialProvider =
  (typeof SUPPORTED_CREDENTIAL_PROVIDERS)[number];

/**
 * Business purpose: Present owner-scoped provider credential status and safe management actions in Settings.
 * Business rules: New credential operations require backend readiness; disconnected or unavailable providers may still be managed only when a stored credential exists so it can be removed.
 * Execution flow: 1. Project status by provider. 2. Show lifecycle and readiness. 3. Open the existing connect/manage dialog for an allowed action.
 * Failure cases: Unknown or unavailable status does not enable a new credential write; status loading failures keep actions closed.
 * Side effects: Reads status queries and may open credential dialogs; this component does not persist credential data itself.
 */
export function RepositoriesSettingsSection({
  providerCredentialStatuses = [],
  isLoading = false,
  loadFailed = false,
  onRetry,
  onReauthenticate,
}: RepositoriesSettingsSectionProps) {
  const patAccessHeadingId = useId();
  const [credentialDialog, setCredentialDialog] = useState<{
    mode: ProviderCredentialDialogMode;
    provider: CredentialProvider;
  } | null>(null);
  const statusByProvider = useMemo(
    () =>
      new Map(
        providerCredentialStatuses.map((status) => [status.provider, status]),
      ),
    [providerCredentialStatuses],
  );
  const githubStatus = statusByProvider.get(CREDENTIAL_PROVIDERS.github);
  const githubConfigured = githubStatus?.configured === true;
  const statusesKnown = !isLoading && !loadFailed;
  const noneConnected =
    statusesKnown &&
    !CONNECTOR_PROVIDER_OPTIONS.some((option) =>
      hasProviderCredential(statusByProvider.get(option.id)),
    );

  function openCredentialDialog(
    provider: SupportedCredentialProvider,
    mode: ProviderCredentialDialogMode,
  ) {
    setCredentialDialog({ provider, mode });
  }

  return (
    <section
      // Keep provider states and the access card in normal flow so wrapping and empty messages cannot overlap.
      className="h-full min-h-0 space-y-6 overflow-y-auto px-4 py-6 text-foreground md:px-8 md:py-8"
      data-component="ConnectorsSettingsPanel"
    >
      <p className="text-sm text-muted-foreground">
        {resolveMessage(
          appLocale,
          "pages.workspace.settingsHub.repositories.manageProvidersDescription",
        )}
      </p>
      <div className="space-y-3">
        <h2 className="text-base font-semibold">
          {resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.repositories.gitProvidersTitle",
          )}
        </h2>
        <div
          className="flex flex-col gap-2"
          data-component="ConnectorProviderList"
        >
          {isLoading ? (
            <p role="status" className="text-sm text-muted-foreground">
              {resolveMessage(
                appLocale,
                "pages.workspace.settingsHub.repositories.statusLoading",
              )}
            </p>
          ) : null}
          {loadFailed ? (
            <Alert variant="destructive" data-component="ConnectorLoadError">
              <AlertTitle>
                {resolveMessage(
                  appLocale,
                  "pages.workspace.settingsHub.repositories.loadFailedTitle",
                )}
              </AlertTitle>
              <AlertDescription>
                {resolveMessage(
                  appLocale,
                  "pages.workspace.settingsHub.repositories.loadFailedDescription",
                )}
              </AlertDescription>
              {onRetry ? (
                <Button
                  className="mt-2 w-fit"
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onRetry}
                >
                  {resolveMessage(
                    appLocale,
                    "pages.workspace.settingsHub.repositories.retry",
                  )}
                </Button>
              ) : null}
            </Alert>
          ) : null}
          {noneConnected ? (
            <p className="text-sm text-muted-foreground">
              {resolveMessage(
                appLocale,
                "pages.workspace.settingsHub.repositories.noneConnectedDescription",
              )}
            </p>
          ) : null}
          {statusesKnown
            ? CONNECTOR_PROVIDER_OPTIONS.map((option) => {
                const providerStatus = statusByProvider.get(
                  option.id as CredentialProvider,
                );
                const connectionState =
                  getProviderConnectionState(providerStatus);
                const configured =
                  option.supported && hasProviderCredential(providerStatus);
                const providerDeploymentEnabled =
                  providerStatus?.enabled ??
                  (option.id === CREDENTIAL_PROVIDERS.github ||
                    option.id === CREDENTIAL_PROVIDERS.gitlab);
                const providerAvailable = providerStatus?.available !== false;
                const providerEnabled =
                  providerDeploymentEnabled && providerAvailable;
                const actionLabel = configured
                  ? "pages.workspace.settingsHub.repositories.managePat"
                  : "pages.workspace.settingsHub.repositories.connect";
                const credentialProvider =
                  option.id as SupportedCredentialProvider;
                return (
                  <div
                    // Stack status under the provider name when a full desktop status column would crowd the action.
                    className="flex min-h-13 items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2 sm:gap-4"
                    data-component="ConnectorProviderRow"
                    data-provider={option.id}
                    key={option.id}
                  >
                    <Image
                      alt=""
                      aria-hidden="true"
                      className="size-6 shrink-0"
                      height={24}
                      src={option.logo}
                      width={24}
                    />
                    <div className="grid min-w-0 flex-1 gap-0.5 sm:flex sm:items-center sm:gap-4">
                      <p className="min-w-0 flex-1 text-sm font-medium">
                        {resolveMessage(appLocale, option.labelKey)}
                      </p>
                      <span
                        className={cn(
                          "text-xs sm:w-32 sm:shrink-0 sm:text-sm",
                          PROVIDER_CONNECTION_TONE_CLASSES[connectionState],
                        )}
                        data-connection-state={connectionState}
                      >
                        {resolveMessage(
                          appLocale,
                          PROVIDER_CONNECTION_LABEL_KEYS[connectionState],
                        )}
                      </span>
                      {providerStatus?.implemented && !providerDeploymentEnabled ? (
                        <span
                          className="text-xs text-muted-foreground sm:w-48 sm:shrink-0"
                          role="status"
                        >
                          {resolveMessage(
                            appLocale,
                            "pages.workspace.settingsHub.repositories.providerUnavailable",
                          )}
                        </span>
                      ) : null}
                      {providerStatus?.implemented &&
                      providerDeploymentEnabled &&
                      !providerAvailable ? (
                        <span
                          className="text-xs text-muted-foreground sm:w-48 sm:shrink-0"
                          role="status"
                        >
                          {resolveMessage(
                            appLocale,
                            "pages.workspace.settingsHub.repositories.providerTemporarilyUnavailable",
                          )}
                        </span>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 shrink-0 sm:w-28"
                      disabled={!option.supported || (!providerEnabled && !configured)}
                      onClick={() => {
                        if (
                          SUPPORTED_CREDENTIAL_PROVIDERS.includes(
                            credentialProvider,
                          )
                        ) {
                          openCredentialDialog(
                            credentialProvider,
                            configured
                              ? PROVIDER_CREDENTIAL_DIALOG_MODES.manage
                              : PROVIDER_CREDENTIAL_DIALOG_MODES.connect,
                          );
                        }
                      }}
                    >
                      {resolveMessage(appLocale, actionLabel)}
                    </Button>
                  </div>
                );
              })
            : null}
        </div>
      </div>

      {/* Show GitHub-specific access only when its own PAT can be managed, including expired credentials. */}
      {statusesKnown && hasProviderCredential(githubStatus) ? (
        <section
          aria-labelledby={patAccessHeadingId}
          className="rounded-xl border border-border bg-card"
        >
          {/* Keep the PAT action in the card header and let longer translations wrap within the card. */}
          <header className="flex flex-wrap items-center justify-between gap-3 rounded-t-xl border-b border-border bg-muted/30 px-4 py-3">
            <h2
              id={patAccessHeadingId}
              className="flex min-w-0 items-center gap-2 text-sm font-semibold sm:text-base"
            >
              <ShieldCheckIcon
                className="size-5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              {resolveMessage(
                appLocale,
                "pages.workspace.settingsHub.repositories.githubPatAccessTitle",
              )}
            </h2>
            <Button
              className="ml-auto shrink-0"
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                openCredentialDialog(
                  CREDENTIAL_PROVIDERS.github,
                  PROVIDER_CREDENTIAL_DIALOG_MODES.update,
                )
              }
            >
              {resolveMessage(
                appLocale,
                "pages.workspace.settingsHub.repositories.updatePat",
              )}
            </Button>
          </header>
          <dl className="divide-y divide-border">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
              <dt className="text-sm font-medium">
                {resolveMessage(
                  appLocale,
                  "pages.workspace.settingsHub.repositories.repositoryReadAccess",
                )}
              </dt>
              <dd>
                <Badge
                  variant="secondary"
                  className={cn(
                    githubConfigured && "bg-primary/10 text-primary",
                  )}
                >
                  {resolveMessage(
                    appLocale,
                    githubConfigured
                      ? "pages.workspace.settingsHub.repositories.connected"
                      : "pages.workspace.settingsHub.repositories.notConnected",
                  )}
                </Badge>
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
              <dt className="text-sm font-medium">
                {resolveMessage(
                  appLocale,
                  "pages.workspace.settingsHub.repositories.codeRemediationWriteAccess",
                )}
              </dt>
              <dd className="text-sm text-muted-foreground">
                {resolveMessage(
                  appLocale,
                  "pages.workspace.settingsHub.repositories.codeRemediationWriteHelper",
                )}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}
      {credentialDialog ? (
        <ProviderCredentialDialog
          open={credentialDialog !== null}
          mode={credentialDialog.mode}
          onModeChange={(mode) =>
            setCredentialDialog((current) =>
              current ? { ...current, mode } : current,
            )
          }
          onOpenChange={(open) => {
            if (!open) {
              setCredentialDialog(null);
            }
          }}
          provider={credentialDialog.provider}
          status={statusByProvider.get(credentialDialog.provider)}
          onReauthenticate={onReauthenticate}
        />
      ) : null}
    </section>
  );
}
