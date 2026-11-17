"use client";

import {
  CREDENTIAL_PROVIDERS,
  type CredentialProvider,
} from "@lcsp/contracts/github-integration";
import { resolveMessage } from "@lcsp/i18n";
import Image from "next/image";
import { useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

const PROVIDER_LOGOS = {
  github: "/assets/figma/settings/logo-github.svg",
  gitlab: "/assets/figma/settings/logo-gitlab.svg",
  bitbucket: "/assets/figma/settings/logo-bitbucket.svg",
  azureDevOps: "/assets/figma/settings/logo-azure-devops.svg",
} as const;

const CONNECTOR_PROVIDER_OPTIONS = [
  {
    id: CREDENTIAL_PROVIDERS.github,
    logo: PROVIDER_LOGOS.github,
    labelKey: "pages.workspace.settingsHub.repositories.githubProvider",
    supported: true,
  },
  {
    id: CREDENTIAL_PROVIDERS.gitlab,
    logo: PROVIDER_LOGOS.gitlab,
    labelKey: "pages.workspace.settingsHub.repositories.gitlabProvider",
    supported: true,
  },
  {
    id: CREDENTIAL_PROVIDERS.bitbucket,
    logo: PROVIDER_LOGOS.bitbucket,
    labelKey: "pages.workspace.settingsHub.repositories.bitbucketProvider",
    supported: true,
  },
  {
    id: CREDENTIAL_PROVIDERS.azureDevOps,
    logo: PROVIDER_LOGOS.azureDevOps,
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

export function RepositoriesSettingsSection({
  providerCredentialStatuses = [],
  isLoading = false,
  loadFailed = false,
  onRetry,
  onReauthenticate,
}: RepositoriesSettingsSectionProps) {
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
      className="relative h-full min-h-0 overflow-hidden px-8.5 py-10 text-foreground"
      data-component="ConnectorsSettingsPanel"
    >
      <p className="absolute top-19.5 left-8.5 text-[13px] text-muted-foreground">
        {resolveMessage(
          appLocale,
          "pages.workspace.settingsHub.repositories.manageProvidersDescription",
        )}
      </p>
      <h2 className="absolute top-31.5 left-8.5 text-base font-semibold">
        {resolveMessage(
          appLocale,
          "pages.workspace.settingsHub.repositories.gitProvidersTitle",
        )}
      </h2>
      <div
        className="absolute top-41 left-8.5 flex w-218 flex-col gap-2"
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
          <p className="text-[13px] text-muted-foreground">
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
              const actionLabel = configured
                ? "pages.workspace.settingsHub.repositories.managePat"
                : "pages.workspace.settingsHub.repositories.connect";
              const credentialProvider =
                option.id as SupportedCredentialProvider;
              return (
                <div
                  className="flex h-13 items-center rounded-[10px] border border-border bg-muted/40 px-3.5"
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
                  <p className="ml-3.5 min-w-0 flex-1 truncate text-sm font-semibold">
                    {resolveMessage(appLocale, option.labelKey)}
                  </p>
                  <span
                    className={cn(
                      "mr-12 w-28 text-[13px]",
                      PROVIDER_CONNECTION_TONE_CLASSES[connectionState],
                    )}
                    data-connection-state={connectionState}
                  >
                    {resolveMessage(
                      appLocale,
                      PROVIDER_CONNECTION_LABEL_KEYS[connectionState],
                    )}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 min-w-24 px-3.5 text-sm"
                    disabled={!option.supported}
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

      <h2 className="absolute top-104.5 left-8.5 text-base font-semibold">
        {resolveMessage(
          appLocale,
          "pages.workspace.settingsHub.repositories.githubPatAccessTitle",
        )}
      </h2>
      <PatAccessRow
        className="top-114.5"
        labelKey="pages.workspace.settingsHub.repositories.repositoryReadAccess"
        connected={githubConfigured}
        unknown={!statusesKnown}
      />
      <PatAccessRow
        className="top-125"
        labelKey="pages.workspace.settingsHub.repositories.codeRemediationWriteAccess"
        helperKey="pages.workspace.settingsHub.repositories.codeRemediationWriteHelper"
      />
      <Button
        className="absolute top-134.5 left-191 h-9 w-27.5 text-sm"
        type="button"
        variant="outline"
        disabled={!statusesKnown || !hasProviderCredential(githubStatus)}
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

function PatAccessRow({
  className,
  connected,
  helperKey,
  labelKey,
  unknown = false,
}: {
  className: string;
  connected?: boolean;
  /** Hide the connected/not-connected claim while the connection state is unknown. */
  unknown?: boolean;
  helperKey?: Parameters<typeof resolveMessage>[1];
  labelKey: Parameters<typeof resolveMessage>[1];
}) {
  return (
    <div
      className={`absolute left-8.5 flex h-9 w-218 items-center ${className}`}
    >
      <p className="min-w-0 flex-1 truncate text-[13px]">
        {resolveMessage(appLocale, labelKey)}
      </p>
      {helperKey ? (
        <p className="mr-30 w-70 truncate text-xs text-muted-foreground">
          {resolveMessage(appLocale, helperKey)}
        </p>
      ) : unknown ? null : (
        <span
          className={cn(
            "mr-30 w-24 text-xs",
            connected ? "text-primary" : "text-muted-foreground",
          )}
        >
          {resolveMessage(
            appLocale,
            connected
              ? "pages.workspace.settingsHub.repositories.connected"
              : "pages.workspace.settingsHub.repositories.notConnected",
          )}
        </span>
      )}
    </div>
  );
}
