"use client";
import { REQUIRED_ACTIONS } from "@lcsp/contracts/auth";
import { CREDENTIAL_PROVIDERS } from "@lcsp/contracts/github-integration";
import { resolveMessage } from "@lcsp/i18n";
import React from "react";
import { useMemo, useState } from "react";
import { KeyRoundIcon } from "lucide-react";
import { SectionHeading } from "@/components/molecules/section-heading";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useConfigureProviderCredentialMutation } from "@/lib/api/github-repository-queries";
import { appLocale } from "@/lib/locale";
import type { RepositoriesSettingsSectionProps } from "../../types/settings-page.types";
export function RepositoriesSettingsSection({
  providerCredentialStatuses = [],
  onReauthenticate,
}: RepositoriesSettingsSectionProps) {
  const [provider, setProvider] = useState(CREDENTIAL_PROVIDERS.github);
  const [credential, setCredential] = useState("");
  const [reauthRequired, setReauthRequired] = useState(false);
  const mutation = useConfigureProviderCredentialMutation();
  const status = useMemo(
    () => providerCredentialStatuses.find((item) => item.provider === provider),
    [providerCredentialStatuses, provider],
  );
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!credential.trim() || mutation.isPending) return;
    mutation.mutate(
      { provider, credential },
      {
        onSuccess: () => {
          setCredential("");
          setReauthRequired(false);
        },
        onError: (error) => {
          if (
            error instanceof Error &&
            "requiredAction" in error &&
            error.requiredAction === REQUIRED_ACTIONS.reauthenticate
          ) {
            setCredential("");
            setReauthRequired(true);
            onReauthenticate?.(() => {
              queueMicrotask(() => {
                mutation.mutate({ provider, credential });
              });
            });
          }
        },
      },
    );
  }
  const providerLabel = resolveMessage(
    appLocale,
    provider === CREDENTIAL_PROVIDERS.github
      ? "pages.workspace.settingsHub.repositories.githubProvider"
      : "pages.workspace.settingsHub.repositories.gitlabProvider",
  );
  return (
    <section className="flex flex-col gap-4">
      <SectionHeading
        title={resolveMessage(
          appLocale,
          "pages.workspace.settingsHub.repositories.title",
        )}
        description={resolveMessage(
          appLocale,
          "pages.workspace.settingsHub.repositories.description",
        )}
        icon={<KeyRoundIcon className="size-4" />}
      />
      <Card>
        <CardHeader>
          <CardTitle>{providerLabel}</CardTitle>
          <CardDescription>
            {status?.configured
              ? resolveMessage(
                  appLocale,
                  "pages.workspace.settingsHub.badges.configured",
                )
              : resolveMessage(
                  appLocale,
                  "pages.workspace.settingsHub.states.notConfigured",
                )}
            {status?.account?.username ? ` · ${status.account.username}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={submit}>
            <label htmlFor="repository-provider">
              {resolveMessage(
                appLocale,
                "pages.workspace.settingsHub.repositories.providerLabel",
              )}
              <select
                id="repository-provider"
                value={provider}
                onChange={(event) =>
                  (() => {
                    setProvider(event.target.value as typeof provider);
                    setCredential("");
                  })()
                }
              >
                <option value={CREDENTIAL_PROVIDERS.github}>GitHub</option>
                <option value={CREDENTIAL_PROVIDERS.gitlab}>GitLab</option>
              </select>
            </label>
            <label htmlFor="provider-credential">
              {resolveMessage(
                appLocale,
                provider === CREDENTIAL_PROVIDERS.github
                  ? "pages.workspace.settingsHub.repositories.credentialLabel"
                  : "pages.workspace.settingsHub.repositories.gitlabCredentialLabel",
              )}
              <Input
                id="provider-credential"
                type="password"
                autoComplete="new-password"
                value={credential}
                onChange={(event) => setCredential(event.target.value)}
              />
            </label>
            <Button
              type="submit"
              disabled={mutation.isPending || credential.trim().length === 0}
            >
              {resolveMessage(
                appLocale,
                status?.configured
                  ? "pages.workspace.settingsHub.actions.edit"
                  : "pages.workspace.settingsHub.actions.setUp",
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
      {reauthRequired ? (
        <p role="status" className="text-sm text-muted-foreground">
          {resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.reauth.description",
          )}
        </p>
      ) : null}
    </section>
  );
}
