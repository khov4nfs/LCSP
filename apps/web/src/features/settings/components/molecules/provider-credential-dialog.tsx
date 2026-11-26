"use client";

import { REQUIRED_ACTIONS } from "@lcsp/contracts/auth";
import {
  AZURE_DEVOPS_CREDENTIAL_TYPES,
  BITBUCKET_CREDENTIAL_TYPES,
  CREDENTIAL_PROVIDERS,
  GITHUB_CREDENTIAL_ERROR_CODES,
  GITHUB_INTEGRATION_ERROR_CODES,
  PROVIDER_CREDENTIAL_STATUSES,
} from "@lcsp/contracts/github-integration";
import type { CredentialProvider } from "@lcsp/contracts/github-integration";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import { zodResolver } from "@hookform/resolvers/zod";
import Image from "next/image";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { FormProvider, useForm, useFormContext } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  configureProviderCredential,
  GitHubRepositoryRequestError,
  githubRepositoryProblemMessageKey,
  type ProviderCredentialStatus,
  type ProviderCredentialSubmission,
} from "@/lib/api/github-repository-client";
import {
  useDisconnectProviderCredentialMutation,
  useRefreshProviderCredentialStatuses,
} from "@/lib/api/github-repository-queries";
import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

import {
  PROVIDER_CONNECTION_LABEL_KEYS,
  PROVIDER_CONNECTION_TONE_CLASSES,
} from "../../config/provider-connection.config";
import {
  bitbucketProviderCredentialSchema,
  azureProviderCredentialSchema,
  providerCredentialSchema,
  type ProviderCredentialValues,
} from "../../schemas/provider-credential.schema";
import type { ProviderReauthenticateHandler } from "../../types/provider-credential.types";
import { getProviderConnectionState } from "../../utils/provider-connection.utils";
import { ProviderCredentialDisconnectConfirm } from "./provider-credential-disconnect-confirm";

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
  onReauthenticate?: ProviderReauthenticateHandler;
  open: boolean;
  provider: CredentialProvider;
  status?: ProviderCredentialStatus | null;
};

const PROVIDER_LOGOS: Record<CredentialProvider, string> = {
  [CREDENTIAL_PROVIDERS.github]: "/assets/figma/settings/logo-github.svg",
  [CREDENTIAL_PROVIDERS.gitlab]: "/assets/figma/settings/logo-gitlab.svg",
  [CREDENTIAL_PROVIDERS.bitbucket]: "/assets/figma/settings/logo-bitbucket.svg",
  [CREDENTIAL_PROVIDERS.azureDevOps]:
    "/assets/figma/settings/logo-azure-devops.svg",
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
  [CREDENTIAL_PROVIDERS.bitbucket]: {
    connect: "pages.workspace.settingsHub.repositories.connectBitbucketTitle",
    manage: "pages.workspace.settingsHub.repositories.manageBitbucketPatTitle",
    update: "pages.workspace.settingsHub.repositories.updateBitbucketPatTitle",
  },
  [CREDENTIAL_PROVIDERS.azureDevOps]: {
    connect: "pages.workspace.settingsHub.repositories.connectAzureDevOpsTitle",
    manage:
      "pages.workspace.settingsHub.repositories.manageAzureDevOpsPatTitle",
    update:
      "pages.workspace.settingsHub.repositories.updateAzureDevOpsPatTitle",
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
  [CREDENTIAL_PROVIDERS.bitbucket]:
    "pages.workspace.settingsHub.repositories.bitbucketRepositoryCredentialSubtitle",
  [CREDENTIAL_PROVIDERS.azureDevOps]:
    "pages.workspace.settingsHub.repositories.azureDevOpsRepositoryCredentialSubtitle",
} as const satisfies Record<
  CredentialProvider,
  Parameters<typeof resolveMessage>[1]
>;

const PROVIDER_GUIDANCE_KEYS = {
  [CREDENTIAL_PROVIDERS.github]:
    "pages.workspace.settingsHub.repositories.repositoryAccessGuidance",
  [CREDENTIAL_PROVIDERS.gitlab]:
    "pages.workspace.settingsHub.repositories.gitlabRepositoryAccessGuidance",
  [CREDENTIAL_PROVIDERS.bitbucket]:
    "pages.workspace.settingsHub.repositories.bitbucketRepositoryAccessGuidance",
  [CREDENTIAL_PROVIDERS.azureDevOps]:
    "pages.workspace.settingsHub.repositories.azureDevOpsRepositoryAccessGuidance",
} as const satisfies Record<
  CredentialProvider,
  Parameters<typeof resolveMessage>[1]
>;

/**
 * Business purpose: Configure, replace, inspect, or disconnect a provider credential in the existing Settings workflow.
 * Business rules: Bitbucket and Azure submissions use their typed identity-bound contracts and expiry; disabled providers cannot receive new secrets, while existing credentials remain disconnectable.
 * Execution flow: 1. Select the provider-specific schema. 2. Submit a masked typed credential or manage its lifecycle. 3. Confirm saved status from the backend before showing success.
 * Failure cases: Unavailable providers, invalid inputs, failed authorization, or unconfirmed writes remain actionable and never report success.
 * Side effects: May submit encrypted credential changes or disconnect commands through existing API mutations; raw secrets are not cached or displayed.
 */
export function ProviderCredentialDialog({
  mode,
  onModeChange,
  onOpenChange,
  onReauthenticate,
  open,
  provider,
  status,
}: ProviderCredentialDialogProps) {
  const providerEnabled =
    (status?.enabled ??
      (provider === CREDENTIAL_PROVIDERS.github ||
        provider === CREDENTIAL_PROVIDERS.gitlab)) &&
    status?.available !== false;
  // Keep PAT drafts in the mounted form, outside TanStack mutation variables and caches.
  const form = useForm<ProviderCredentialValues>({
    resolver: zodResolver(
      provider === CREDENTIAL_PROVIDERS.azureDevOps
        ? azureProviderCredentialSchema
        : provider === CREDENTIAL_PROVIDERS.bitbucket
          ? bitbucketProviderCredentialSchema
          : providerCredentialSchema,
    ),
    defaultValues: { credential: "", organization: "", email: "", expiresAt: "" },
  });
  const [reauthRequired, setReauthRequired] = useState(false);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<string | null>(
    null,
  );
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [disconnectReauthPending, setDisconnectReauthPending] = useState(false);
  // The verification dialog is a sibling layer; its dismissal must not also close this dialog.
  const disconnectReauthRef = useRef(false);
  const saveOperation = useRef<AbortController | null>(null);
  const refreshStatuses = useRefreshProviderCredentialStatuses();
  const disconnectMutation = useDisconnectProviderCredentialMutation();
  const accountUsername = status?.account?.username?.trim() ?? "";

  // Leaving Settings invalidates a pending proof and aborts the browser's request.
  useEffect(() => () => saveOperation.current?.abort(), []);

  function closeCredentialDialog(nextOpen: boolean) {
    if (
      !nextOpen &&
      (disconnectReauthRef.current || saveOperation.current || confirmationBusy)
    )
      return;
    if (!nextOpen) {
      form.reset();
      setReauthRequired(false);
      setErrorKey(null);
      resetDisconnect();
    }
    onOpenChange(nextOpen);
  }

  function resetDisconnect() {
    disconnectReauthRef.current = false;
    setConfirmingDisconnect(false);
    setDisconnectError(null);
    setDisconnectReauthPending(false);
  }

  /**
   * Business purpose: Disconnect the provider only after backend confirmation, retrying once after identity confirmation.
   * Business rules:
   * - Success is reported only when the backend acknowledges the disconnect; the connection list is refreshed first.
   * - A challenged request waits for the shared reauthentication flow; cancellation never retries.
   * Failure cases:
   * - Any other failure keeps the provider connected, keeps the dialog open and shows an error without success.
   * Side effects:
   * - Calls the disconnect mutation, may open reauthentication, and closes the dialog on confirmed success.
   */
  function submitDisconnect() {
    disconnectReauthRef.current = false;
    setDisconnectError(null);
    setDisconnectReauthPending(false);
    disconnectMutation.mutate(provider, {
      onSuccess: () => {
        toast.success(
          resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.repositories.disconnectSuccessTitle",
          ),
        );
        closeCredentialDialog(false);
      },
      onError: (error) => {
        if (
          error instanceof Error &&
          "requiredAction" in error &&
          error.requiredAction === REQUIRED_ACTIONS.reauthenticate &&
          onReauthenticate
        ) {
          disconnectReauthRef.current = true;
          setDisconnectReauthPending(true);
          onReauthenticate(
            () => queueMicrotask(submitDisconnect),
            () => {
              disconnectReauthRef.current = false;
              setDisconnectReauthPending(false);
              setDisconnectError(
                resolveMessage(
                  appLocale,
                  "pages.workspace.settingsHub.repositories.disconnectReauthCancelled",
                ),
              );
            },
          );
          return;
        }
        setDisconnectError(
          resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.repositories.disconnectFailedDescription",
          ),
        );
      },
    });
  }

  function changeMode(nextMode: ProviderCredentialDialogMode) {
    // Changing modes discards the masked draft and any previous confirmation state.
    form.reset();
    setReauthRequired(false);
    setErrorKey(null);
    setPendingConfirmation(null);
    resetDisconnect();
    onModeChange(nextMode);
  }

  /**
   * Business purpose: Confirm the provider status after an acknowledged PAT save.
   * Business rules: Only fresh active status for the expected provider account confirms success.
   * Execution flow:
   * 1. Read the current provider statuses and compare with the acknowledged account.
   * 2. Announce the confirmed save and return to the updated provider list or details.
   * Failure cases: Unavailable or mismatched reads offer a read-only retry.
   * Side effects: Refreshes shared state and announces confirmed results.
   */
  async function confirmCredential(
    expectedUsername: string,
    signal: AbortSignal,
  ) {
    setConfirmationBusy(true);
    setErrorKey(null);
    try {
      const statuses = await refreshStatuses();
      if (signal.aborted) return;
      const confirmed = statuses.some(
        (entry) =>
          entry.provider === provider &&
          entry.configured &&
          entry.status === PROVIDER_CREDENTIAL_STATUSES.active &&
          entry.account?.username === expectedUsername,
      );
      if (!confirmed) {
        setErrorKey(
          "pages.workspace.settingsHub.repositories.credentialConfirmationFailed",
        );
        return;
      }
      setPendingConfirmation(null);
      toast.success(
        resolveMessage(
          appLocale,
          mode === PROVIDER_CREDENTIAL_DIALOG_MODES.update
            ? "pages.workspace.settingsHub.repositories.credentialUpdated"
            : "pages.workspace.settingsHub.repositories.credentialConnected",
        ),
      );
      if (mode === PROVIDER_CREDENTIAL_DIALOG_MODES.update) {
        onModeChange(PROVIDER_CREDENTIAL_DIALOG_MODES.manage);
      } else {
        onOpenChange(false);
      }
    } catch {
      if (!signal.aborted)
        setErrorKey(
          "pages.workspace.settingsHub.repositories.credentialConfirmationFailed",
        );
    } finally {
      if (!signal.aborted) setConfirmationBusy(false);
    }
  }

  /**
   * Business purpose: Save a provider-specific credential with explicit identity context and declared expiry.
   * Business rules: Bitbucket requires account email and API Token, Azure requires organization and PAT, and GitHub/GitLab retain their string contract; only completed verification can authorize one automatic retry.
   * Execution flow:
   * 1. Submit the validated PAT and request proof only on a backend challenge.
   * 2. Retry once after proof, then clear the acknowledged draft and confirm by reading status.
   * Failure cases: Cancellation clears the PAT; other failures keep the masked draft and report the error.
   * Side effects: May update the provider credential and its shared status.
   */
  async function submitCredential({ credential, organization, email, expiresAt }: ProviderCredentialValues) {
    if (saveOperation.current || pendingConfirmation !== null) return;
    const operation = new AbortController();
    saveOperation.current = operation;
    const { signal } = operation;
    setErrorKey(null);
    const credentialExpiresAt = expiresAt
      ? new Date(`${expiresAt}T23:59:59.999Z`).toISOString()
      : undefined;
    const submission: ProviderCredentialSubmission =
      provider === CREDENTIAL_PROVIDERS.bitbucket
        ? {
            provider,
            credential: {
              type: BITBUCKET_CREDENTIAL_TYPES.atlassianApiToken,
              email,
              apiToken: credential,
            },
            credential_expires_at: credentialExpiresAt,
          }
        : provider === CREDENTIAL_PROVIDERS.azureDevOps
          ? {
              provider,
              credential: {
                type: AZURE_DEVOPS_CREDENTIAL_TYPES.organizationPat,
                organization,
                pat: credential,
              },
              credential_expires_at: credentialExpiresAt,
            }
          : { provider, credential, credential_expires_at: credentialExpiresAt };
    const write = () => configureProviderCredential(submission, signal);
    try {
      let acknowledged;
      try {
        acknowledged = await write();
      } catch (error) {
        if (
          signal.aborted ||
          !(error instanceof GitHubRepositoryRequestError) ||
          error.requiredAction !== REQUIRED_ACTIONS.reauthenticate ||
          !onReauthenticate
        )
          throw error;
        setReauthRequired(true);
        // A settled or abandoned verification cannot retry, even if its response arrives later.
        const confirmed = await new Promise<boolean>((resolve) => {
          signal.addEventListener("abort", () => resolve(false), {
            once: true,
          });
          onReauthenticate?.(
            () => resolve(true),
            () => resolve(false),
          );
        });
        if (signal.aborted) return;
        setReauthRequired(false);
        if (!confirmed) {
          form.resetField("credential");
          setErrorKey(
            "pages.workspace.settingsHub.repositories.credentialVerificationCanceled",
          );
          return;
        }
        acknowledged = await write();
      }
      if (signal.aborted || !acknowledged.account) return;
      form.reset();
      const username = acknowledged.account.username;
      setPendingConfirmation(username);
      await confirmCredential(username, signal);
    } catch (error) {
      if (signal.aborted) return;
      const message = githubRepositoryProblemMessageKey(error);
      if (
        error instanceof GitHubRepositoryRequestError &&
        (error.problemCode ===
          GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid ||
          error.problemCode ===
            GITHUB_CREDENTIAL_ERROR_CODES.credentialExpired ||
          error.problemCode ===
            GITHUB_INTEGRATION_ERROR_CODES.credentialRequestInvalid)
      ) {
        form.setError("credential", {
          message:
            "pages.workspace.settingsHub.repositories.credentialInvalidDescription",
        });
      } else {
        setErrorKey(message);
      }
    } finally {
      saveOperation.current = null;
    }
  }

  /**
   * Business purpose: Recover an unconfirmed credential status after a recorded save.
   * Business rules:
   * - A saved acknowledgement can only be checked by reading provider status.
   * Execution flow:
   * 1. Claim the active dialog operation and refresh the previously acknowledged provider.
   * Failure cases:
   * - An unconfirmed read stays available for retry without repeating the write.
   * Side effects:
   * - Refreshes provider metadata and may announce a confirmed save.
   */
  async function retryCredentialConfirmation() {
    if (pendingConfirmation === null || saveOperation.current) return;
    // Share the operation guard so leaving Settings also cancels confirmation feedback.
    const operation = new AbortController();
    saveOperation.current = operation;
    try {
      await confirmCredential(pendingConfirmation, operation.signal);
    } finally {
      saveOperation.current = null;
    }
  }

  return (
    <Dialog open={open} onOpenChange={closeCredentialDialog}>
      <DialogContent
        className={cn(
          "max-h-[calc(100svh-2rem)] max-w-140 gap-0 overflow-y-auto rounded-2xl p-6",
          provider === CREDENTIAL_PROVIDERS.azureDevOps ? "h-122.5" : "h-107.5",
        )}
        closeLabel={resolveMessage(
          appLocale,
          "pages.workspace.settingsHub.repositories.dialogClose",
        )}
        data-component="ProviderCredentialDialog"
        data-mode={mode}
      >
        <CredentialDialogHeader mode={mode} provider={provider} />
        {mode === PROVIDER_CREDENTIAL_DIALOG_MODES.manage &&
        confirmingDisconnect ? (
          <ProviderCredentialDisconnectConfirm
            errorMessage={disconnectError}
            isPending={disconnectMutation.isPending}
            onCancel={resetDisconnect}
            onConfirm={submitDisconnect}
            reauthPending={disconnectReauthPending}
          />
        ) : mode === PROVIDER_CREDENTIAL_DIALOG_MODES.manage ? (
          <ManageCredentialContent
            accountUsername={accountUsername}
            provider={provider}
            onDisconnectRequest={() => setConfirmingDisconnect(true)}
            onModeChange={changeMode}
            status={status}
            providerEnabled={providerEnabled}
          />
        ) : (
          <FormProvider {...form}>
            <CredentialForm
              accountUsername={accountUsername}
              errorKey={errorKey}
              isPending={form.formState.isSubmitting || confirmationBusy}
              confirmationPending={pendingConfirmation !== null}
              onConfirmStatus={retryCredentialConfirmation}
              mode={mode}
              onCancel={() => {
                if (mode === PROVIDER_CREDENTIAL_DIALOG_MODES.update) {
                  changeMode(PROVIDER_CREDENTIAL_DIALOG_MODES.manage);
                  return;
                }
                closeCredentialDialog(false);
              }}
              onSubmit={form.handleSubmit(submitCredential)}
              provider={provider}
              providerEnabled={providerEnabled}
              reauthRequired={reauthRequired}
            />
          </FormProvider>
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
  errorKey,
  confirmationPending,
  onConfirmStatus,
  isPending,
  mode,
  onCancel,
  onSubmit,
  provider,
  providerEnabled,
  reauthRequired,
}: {
  accountUsername: string;
  errorKey: MessageKey | null;
  confirmationPending: boolean;
  onConfirmStatus: () => Promise<void>;
  isPending: boolean;
  mode: ProviderCredentialDialogMode;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  provider: CredentialProvider;
  providerEnabled: boolean;
  reauthRequired: boolean;
}) {
  const isUpdateMode = mode === PROVIDER_CREDENTIAL_DIALOG_MODES.update;
  const {
    register,
    formState: { errors },
  } = useFormContext<ProviderCredentialValues>();
  const organizationError = errors.organization?.message as
    MessageKey | undefined;
  const emailError = errors.email?.message as MessageKey | undefined;
  const expiryError = errors.expiresAt?.message as MessageKey | undefined;
  const credentialError = errors.credential?.message as MessageKey | undefined;

  return (
    <form className="mt-4 flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
      {provider !== CREDENTIAL_PROVIDERS.azureDevOps ? (
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
      ) : null}
      {provider === CREDENTIAL_PROVIDERS.bitbucket ? (
        <div className="mt-4 flex min-h-18 flex-col gap-2">
          <label className="text-[13px] font-medium" htmlFor="provider-email">
            {resolveMessage(appLocale, "pages.workspace.settingsHub.repositories.bitbucketEmailLabel")}
          </label>
          <Input
            id="provider-email"
            className="h-11 text-[13px]"
            type="email"
            autoComplete="username"
            {...register("email")}
            readOnly={isPending || confirmationPending}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? "provider-email-error" : undefined}
          />
          {emailError ? <p id="provider-email-error" role="alert" className="text-xs text-destructive">{resolveMessage(appLocale, emailError)}</p> : null}
        </div>
      ) : null}
      {provider === CREDENTIAL_PROVIDERS.azureDevOps ? (
        <div className="mt-4 flex min-h-18 flex-col gap-2">
          <label
            className="text-[13px] font-medium"
            htmlFor="provider-organization"
          >
            {resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.repositories.azureDevOpsOrganizationLabel",
            )}
          </label>
          <Input
            id="provider-organization"
            className="h-11 text-[13px]"
            type="text"
            placeholder={resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.repositories.azureDevOpsOrganizationPlaceholder",
            )}
            {...register("organization")}
            readOnly={isPending || confirmationPending}
            aria-invalid={organizationError ? true : undefined}
            aria-describedby={
              organizationError ? "provider-organization-error" : undefined
            }
          />
          {organizationError ? (
            <p
              id="provider-organization-error"
              role="alert"
              className="text-xs text-destructive"
            >
              {resolveMessage(appLocale, organizationError)}
            </p>
          ) : null}
        </div>
      ) : null}
      {provider === CREDENTIAL_PROVIDERS.bitbucket || provider === CREDENTIAL_PROVIDERS.azureDevOps ? (
        <div className="mt-4 flex min-h-18 flex-col gap-2">
          <label className="text-[13px] font-medium" htmlFor="provider-expiry">
            {resolveMessage(appLocale, "pages.workspace.settingsHub.repositories.credentialExpiryLabel")}
          </label>
          <Input
            id="provider-expiry"
            className="h-11 text-[13px]"
            type="date"
            {...register("expiresAt")}
            readOnly={isPending || confirmationPending}
            aria-invalid={expiryError ? true : undefined}
            aria-describedby={expiryError ? "provider-expiry-error" : undefined}
          />
          {expiryError ? <p id="provider-expiry-error" role="alert" className="text-xs text-destructive">{resolveMessage(appLocale, expiryError)}</p> : null}
        </div>
      ) : null}
      <div className="mt-4 flex min-h-18 flex-col gap-2">
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
          {...register("credential")}
          readOnly={isPending || confirmationPending}
          aria-invalid={credentialError ? true : undefined}
          aria-describedby={
            credentialError ? "provider-credential-error" : undefined
          }
        />
        {credentialError ? (
          <p
            id="provider-credential-error"
            role="alert"
            className="text-xs text-destructive"
          >
            {resolveMessage(appLocale, credentialError)}
          </p>
        ) : null}
      </div>
      <div
        className="mt-4 flex h-16.5 items-center rounded-lg border border-border bg-muted/35 px-3 text-xs leading-5 text-muted-foreground"
        data-component="CredentialAccessGuidance"
      >
        {resolveMessage(appLocale, PROVIDER_GUIDANCE_KEYS[provider])}
      </div>
      {!providerEnabled ? (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          {resolveMessage(appLocale, "pages.workspace.settingsHub.repositories.providerUnavailable")}
        </p>
      ) : null}
      {errorKey && !reauthRequired ? (
        <p role="alert" className="mt-2 text-xs font-medium text-destructive">
          {resolveMessage(appLocale, errorKey)}
        </p>
      ) : null}
      {reauthRequired ? (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          {resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.reauth.description",
          )}
        </p>
      ) : null}
      {/* Keep confirmation retry separate from submit so a failed read cannot repeat a PAT write. */}
      <DialogFooter className="mt-auto flex-row flex-wrap justify-end gap-2.5 px-0 pt-4 pb-0">
        <Button
          className="h-9 w-23"
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={onCancel}
        >
          {resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.repositories.cancel",
          )}
        </Button>
        {confirmationPending ? (
          <Button
            type="button"
            disabled={isPending || !providerEnabled}
            onClick={() => void onConfirmStatus()}
          >
            {resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.repositories.credentialConfirmationRetry",
            )}
          </Button>
        ) : (
          <Button
            className={cn("h-9", isUpdateMode ? "min-w-21" : "min-w-25")}
            type="submit"
            disabled={isPending || !providerEnabled}
          >
            {resolveMessage(
              appLocale,
              isPending && !reauthRequired
                ? "pages.workspace.settingsHub.repositories.credentialSaving"
                : isUpdateMode
                  ? "pages.workspace.settingsHub.repositories.save"
                  : "pages.workspace.settingsHub.repositories.connect",
            )}
          </Button>
        )}
      </DialogFooter>
    </form>
  );
}

function ManageCredentialContent({
  accountUsername,
  provider,
  onDisconnectRequest,
  onModeChange,
  status,
  providerEnabled,
}: {
  accountUsername: string;
  provider: CredentialProvider;
  onDisconnectRequest: () => void;
  onModeChange: (mode: ProviderCredentialDialogMode) => void;
  status?: ProviderCredentialStatus | null;
  providerEnabled: boolean;
}) {
  const connectionState = getProviderConnectionState(status);
  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 items-center justify-between rounded-lg border border-border bg-muted/35 px-3">
        <span className="text-[13px] text-muted-foreground">
          {resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.repositories.connectionStatus",
          )}
        </span>
        <span
          className={cn(
            "text-[13px] font-medium",
            PROVIDER_CONNECTION_TONE_CLASSES[connectionState],
          )}
          data-connection-state={connectionState}
        >
          {resolveMessage(
            appLocale,
            PROVIDER_CONNECTION_LABEL_KEYS[connectionState],
          )}
        </span>
      </div>
      <div
        className="mt-4 flex h-31 flex-col rounded-lg border border-border bg-muted/35 p-2"
        data-component="ProviderCredentialDetails"
      >
        <CredentialDetailRow
          labelKey={
            provider === CREDENTIAL_PROVIDERS.azureDevOps
              ? "pages.workspace.settingsHub.repositories.azureDevOpsOrganizationAccess"
              : "pages.workspace.settingsHub.repositories.username"
          }
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
      {provider === CREDENTIAL_PROVIDERS.azureDevOps ? (
        <p className="mt-2 text-xs leading-4 text-muted-foreground">
          {resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.repositories.azureDevOpsIdentityNotice",
          )}
        </p>
      ) : null}
      <p className="mt-4 h-8.5 text-xs leading-4 text-muted-foreground">
        {resolveMessage(
          appLocale,
          "pages.workspace.settingsHub.repositories.credentialStoredHelper",
        )}
      </p>
      {provider === CREDENTIAL_PROVIDERS.bitbucket ||
      provider === CREDENTIAL_PROVIDERS.azureDevOps ? (
        <p className="mt-2 text-xs leading-4 text-muted-foreground">
          {resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.repositories.credentialRotationReconnect",
          )}
        </p>
      ) : null}
      <DialogFooter className="mt-auto flex-row justify-end gap-2.5 px-0 pb-0">
        <Button
          className="h-9 w-28"
          type="button"
          variant="destructive"
          onClick={onDisconnectRequest}
        >
          {resolveMessage(
            appLocale,
            "pages.workspace.settingsHub.repositories.disconnect",
          )}
        </Button>
        <Button
          className="h-9 w-29.5"
          type="button"
          variant="outline"
          disabled={!providerEnabled}
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
