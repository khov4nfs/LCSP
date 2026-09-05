"use client";

import { REQUIRED_ACTIONS } from "@lcsp/contracts/auth";
import { CREDENTIAL_PROVIDERS } from "@lcsp/contracts/github-integration";
import type { CredentialProvider } from "@lcsp/contracts/github-integration";
import { resolveMessage } from "@lcsp/i18n";
import Image from "next/image";
import type { FormEvent } from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ProviderCredentialStatus } from "@/lib/api/github-repository-client";
import { useConfigureProviderCredentialMutation } from "@/lib/api/github-repository-queries";
import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

export const PROVIDER_CREDENTIAL_DIALOG_MODES = {
  connect: "connect",
  manage: "manage",
  update: "update",
} as const;

export type ProviderCredentialDialogMode =
  (typeof PROVIDER_CREDENTIAL_DIALOG_MODES)[keyof typeof PROVIDER_CREDENTIAL_DIALOG_MODES];

type ProviderCredentialDialogProps = {
  mode: ProviderCredentialDialogMode;
  onModeChange: (mode: ProviderCredentialDialogMode) => void;
  onOpenChange: (open: boolean) => void;
  onReauthenticate?: (retry: () => void) => void;
  open: boolean;
  provider: CredentialProvider;
  status?: ProviderCredentialStatus | null;
};

const PROVIDER_LOGOS: Record<CredentialProvider, string> = {
  [CREDENTIAL_PROVIDERS.github]: "/assets/figma/settings/logo-github.svg",
  [CREDENTIAL_PROVIDERS.gitlab]: "/assets/figma/settings/logo-gitlab.svg",
};

const PROVIDER_TITLE_KEYS = {
  [CREDENTIAL_PROVIDERS.github]: {
    connect: "pages.workspace.settingsHub.repositories.connectGithubTitle",
    manage: "pages.workspace.settingsHub.repositories.manageGithubPatTitle",
    update: "pages.workspace.settingsHub.repositories.updateGithubPatTitle",
  },
  [CREDENTIAL_PROVIDERS.gitlab]: {
    connect: "pages.workspace.settingsHub.repositories.connectGitlabTitle",
    manage: "pages.workspace.settingsHub.repositories.manageGitlabPatTitle",
    update: "pages.workspace.settingsHub.repositories.updateGitlabPatTitle",
  },
} as const satisfies Record<
  CredentialProvider,
  Record<ProviderCredentialDialogMode, Parameters<typeof resolveMessage>[1]>
>;

const PROVIDER_SUBTITLE_KEYS = {
  [CREDENTIAL_PROVIDERS.github]:
    "pages.workspace.settingsHub.repositories.githubRepositoryCredentialSubtitle",
  [CREDENTIAL_PROVIDERS.gitlab]:
    "pages.workspace.settingsHub.repositories.gitlabRepositoryCredentialSubtitle",
} as const satisfies Record<
  CredentialProvider,
  Parameters<typeof resolveMessage>[1]
>;

const PROVIDER_GUIDANCE_KEYS = {
  [CREDENTIAL_PROVIDERS.github]:
    "pages.workspace.settingsHub.repositories.repositoryAccessGuidance",
  [CREDENTIAL_PROVIDERS.gitlab]:
    "pages.workspace.settingsHub.repositories.gitlabRepositoryAccessGuidance",
} as const satisfies Record<
  CredentialProvider,
  Parameters<typeof resolveMessage>[1]
>;

export function ProviderCredentialDialog({
  mode,
  onModeChange,
  onOpenChange,
  onReauthenticate,
  open,
  provider,
  status,
}: ProviderCredentialDialogProps) {
  const [credential, setCredential] = useState("");
  const [reauthRequired, setReauthRequired] = useState(false);
  const mutation = useConfigureProviderCredentialMutation();
  const accountUsername = status?.account?.username ?? "";

  function closeCredentialDialog(openState: boolean) {
    if (!openState) {
      setCredential("");
      setReauthRequired(false);
    }
    onOpenChange(openState);
  }

  function changeMode(nextMode: ProviderCredentialDialogMode) {
    setCredential("");
    setReauthRequired(false);
    onModeChange(nextMode);
  }

  function handleMutationSuccess() {
    setCredential("");
    setReauthRequired(false);
    if (mode === PROVIDER_CREDENTIAL_DIALOG_MODES.update) {
      onModeChange(PROVIDER_CREDENTIAL_DIALOG_MODES.manage);
      return;
    }
    onOpenChange(false);
  }

  function submitCredential(submittedCredential: string) {
    mutation.mutate(
      { provider, credential: submittedCredential },
      {
        onSuccess: handleMutationSuccess,
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
                submitCredential(submittedCredential);
              });
            });
          }
        },
      },
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedCredential = credential.trim();
    if (!submittedCredential || mutation.isPending) return;
    submitCredential(submittedCredential);
  }

  return (
    <Dialog open={open} onOpenChange={closeCredentialDialog}>
      <DialogContent
        className="h-[430px] max-h-[calc(100svh-2rem)] max-w-140 gap-0 rounded-2xl p-6"
        closeLabel={resolveMessage(
          appLocale,
          "pages.workspace.settingsHub.repositories.dialogClose",
        )}
        data-component="ProviderCredentialDialog"
        data-mode={mode}
      >
        <CredentialDialogHeader mode={mode} provider={provider} />
        {mode === PROVIDER_CREDENTIAL_DIALOG_MODES.manage ? (
          <ManageCredentialContent
            accountUsername={accountUsername}
            onModeChange={changeMode}
          />
        ) : (
          <CredentialForm
            accountUsername={accountUsername}
            credential={credential}
            isPending={mutation.isPending}
            mode={mode}
            onCancel={() => {
              if (mode === PROVIDER_CREDENTIAL_DIALOG_MODES.update) {
                changeMode(PROVIDER_CREDENTIAL_DIALOG_MODES.manage);
                return;
              }
              closeCredentialDialog(false);
            }}
            onCredentialChange={setCredential}
            onSubmit={submit}
            provider={provider}
            reauthRequired={reauthRequired}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CredentialDialogHeader({
  mode,
  provider,
}: {
  mode: ProviderCredentialDialogMode;
  provider: CredentialProvider;
}) {
  return (
    <div className="flex h-12.5 w-full items-start gap-3 pr-10">
      <Image
        alt=""
        aria-hidden="true"
        className="mt-0.5 size-7 shrink-0"
        height={28}
        src={PROVIDER_LOGOS[provider]}
        width={28}
      />
      <div className="min-w-0">
        <DialogTitle className="text-lg leading-6 font-semibold">
          {resolveMessage(appLocale, PROVIDER_TITLE_KEYS[provider][mode])}
        </DialogTitle>
        <DialogDescription className="mt-1 text-xs leading-4 text-muted-foreground">
          {resolveMessage(appLocale, PROVIDER_SUBTITLE_KEYS[provider])}
        </DialogDescription>
      </div>
    </div>
  );
}

function CredentialForm({
  accountUsername,
  credential,
  isPending,
  mode,
  onCancel,
  onCredentialChange,
  onSubmit,
  provider,
  reauthRequired,
}: {
  accountUsername: string;
  credential: string;
  isPending: boolean;
  mode: ProviderCredentialDialogMode;
  onCancel: () => void;
  onCredentialChange: (credential: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  provider: CredentialProvider;
  reauthRequired: boolean;
}) {
  const isUpdateMode = mode === PROVIDER_CREDENTIAL_DIALOG_MODES.update;

  return (
    <form className="mt-4 flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
      <div className="flex h-18 flex-col gap-2">
        <label className="text-[13px] font-medium" htmlFor="provider-username">
          {resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.repositories.username",
          )}
        </label>
        <div
          className={cn(
            "flex h-11 items-center rounded-lg border border-border bg-muted/35 px-3 text-[13px]",
            accountUsername ? "text-foreground" : "text-muted-foreground",
          )}
          id="provider-username"
          data-field="credential-username"
        >
          {isUpdateMode && accountUsername
            ? accountUsername
            : resolveMessage(
                appLocale,
                "pages.workspace.settingsHub.repositories.detectAccountFromCredential",
              )}
        </div>
      </div>
      <div className="mt-4 flex h-18 flex-col gap-2">
        <label
          className="text-[13px] font-medium"
          htmlFor="provider-credential"
        >
          {resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.repositories.personalAccessToken",
          )}
        </label>
        <Input
          id="provider-credential"
          className="h-11 text-[13px]"
          type="password"
          autoComplete="new-password"
          placeholder={resolveMessage(
            appLocale,
            isUpdateMode
              ? "pages.workspace.settingsHub.repositories.enterNewPat"
              : "pages.workspace.settingsHub.repositories.pastePersonalAccessToken",
          )}
          value={credential}
          onChange={(event) => onCredentialChange(event.target.value)}
        />
      </div>
      <div
        className="mt-4 flex h-16.5 items-center rounded-lg border border-border bg-muted/35 px-3 text-xs leading-5 text-muted-foreground"
        data-component="CredentialAccessGuidance"
      >
        {resolveMessage(appLocale, PROVIDER_GUIDANCE_KEYS[provider])}
      </div>
      {reauthRequired ? (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          {resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.reauth.description",
          )}
        </p>
      ) : null}
      <DialogFooter className="mt-auto flex-row justify-end gap-2.5 px-0 pb-0">
        <Button
          className="h-9 w-23"
          type="button"
          variant="outline"
          onClick={onCancel}
        >
          {resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.repositories.cancel",
          )}
        </Button>
        <Button
          className={cn("h-9", isUpdateMode ? "w-21" : "w-25")}
          type="submit"
          disabled={isPending || credential.trim().length === 0}
        >
          {resolveMessage(
            appLocale,
            isUpdateMode
              ? "pages.workspace.settingsHub.repositories.save"
              : "pages.workspace.settingsHub.repositories.connect",
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ManageCredentialContent({
  accountUsername,
  onModeChange,
}: {
  accountUsername: string;
  onModeChange: (mode: ProviderCredentialDialogMode) => void;
}) {
  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 items-center justify-between rounded-lg border border-border bg-muted/35 px-3">
        <span className="text-[13px] text-muted-foreground">
          {resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.repositories.connectionStatus",
          )}
        </span>
        <span className="text-[13px] font-medium text-primary">
          {resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.repositories.connected",
          )}
        </span>
      </div>
      <div
        className="mt-4 flex h-31 flex-col rounded-lg border border-border bg-muted/35 p-2"
        data-component="ProviderCredentialDetails"
      >
        <CredentialDetailRow
          labelKey="pages.workspace.settingsHub.repositories.username"
          value={
            accountUsername ||
            resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.repositories.detectAccountFromCredential",
            )
          }
        />
        <CredentialDetailRow
          labelKey="pages.workspace.settingsHub.repositories.personalAccessToken"
          value={resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.repositories.credentialStoredSecurely",
          )}
        />
        <CredentialDetailRow
          labelKey="pages.workspace.settingsHub.repositories.repositoryReadAccess"
          value={resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.repositories.repositoryAccessConfigured",
          )}
        />
      </div>
      <p className="mt-4 h-8.5 text-xs leading-4 text-muted-foreground">
        {resolveMessage(
          appLocale,
          "pages.workspace.settingsHub.repositories.credentialStoredHelper",
        )}
      </p>
      <DialogFooter className="mt-auto flex-row justify-end gap-2.5 px-0 pb-0">
        <Button
          className="h-9 w-28"
          type="button"
          variant="destructive"
          disabled
          aria-describedby="provider-disconnect-unavailable"
        >
          {resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.repositories.disconnect",
          )}
        </Button>
        <span id="provider-disconnect-unavailable" className="sr-only">
          {resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.repositories.disconnectUnavailable",
          )}
        </span>
        <Button
          className="h-9 w-29.5"
          type="button"
          variant="outline"
          onClick={() => onModeChange(PROVIDER_CREDENTIAL_DIALOG_MODES.update)}
        >
          {resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.repositories.updatePat",
          )}
        </Button>
      </DialogFooter>
    </div>
  );
}

function CredentialDetailRow({
  labelKey,
  value,
}: {
  labelKey: Parameters<typeof resolveMessage>[1];
  value: string;
}) {
  return (
    <div className="flex h-9 items-center justify-between gap-4 px-2 text-[13px]">
      <span className="text-muted-foreground">
        {resolveMessage(appLocale, labelKey)}
      </span>
      <span className="max-w-70 truncate text-right font-medium">{value}</span>
    </div>
  );
}
