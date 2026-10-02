"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { type AssessmentRepositoryProvider } from "@lcsp/contracts/assessment";
import {
  CREDENTIAL_PROVIDERS,
  GITHUB_CREDENTIAL_ERROR_CODES,
  GITHUB_INTEGRATION_ERROR_CODES,
  type CredentialProvider,
} from "@lcsp/contracts/github-integration";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { ConfirmAccessDialog } from "@/components/organisms/confirm-access-dialog";
import type { ConfirmAccessOtpValues } from "@/components/schemas/confirm-access-dialog.schema";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  PROVIDER_CREDENTIAL_DIALOG_MODES,
  ProviderCredentialDialog,
  type ProviderCredentialDialogMode,
} from "@/features/settings/components/molecules/provider-credential-dialog";
import { AgentTurn } from "@/features/workspace/components/molecules/agent-turn";
import { TurnFooter } from "@/features/workspace/components/molecules/turn-footer";
import { AssessmentComposer } from "@/features/workspace/components/organisms/assessment-composer";
import { AssessmentTranscript } from "@/features/workspace/components/organisms/assessment-transcript";
import { useReadinessStatusQuery } from "@/lib/api/assessment-queries";
import {
  useAuthSettingsProfileQuery,
  useMfaVerifyMutation,
  usePasswordReauthMutation,
} from "@/lib/api/auth-queries";
import { useProviderCredentialStatusesQuery } from "@/lib/api/github-repository-queries";
import { apiQueryKeys } from "@/lib/api/query-keys";
import {
  connectAssessmentRepository,
  getRepositorySetupState,
  pinRepositorySnapshot,
  startAssessmentRepositoryAnalysis,
} from "@/lib/api/repository-analysis-client";
import {
  API_OUTCOME_KINDS,
  API_REDIRECT_LOCATIONS,
} from "@/lib/api/outcome-kinds";
import { useCreateAssessmentMutation } from "@/lib/api/workspace-queries";
import { appLocale } from "@/lib/locale";

import {
  repositorySetupSchema,
  type RepositorySetupFormData,
} from "../../schemas/repository-setup.schema";
import type { GitProviderValue } from "../../types/assessment-flow.types";
import { deriveRepositorySetupAnswer } from "../../utils/repository-setup-history";
import { RepositorySetupConversation } from "./repository-setup-conversation";
import { RepositoryMapTurn } from "./repository-map-turn";
import { RepositoryReviewTurn } from "./repository-review-turn";

type RepositorySetupStepProps = {
  assessmentId?: string;
};

export function RepositorySetupStep({
  assessmentId: initialAssessmentId,
}: RepositorySetupStepProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const createAssessment = useCreateAssessmentMutation();
  const profileQuery = useAuthSettingsProfileQuery();
  const verifyMutation = useMfaVerifyMutation();
  const passwordReauthMutation = usePasswordReauthMutation();
  const credentialStatuses = useProviderCredentialStatusesQuery();
  const [workingAssessmentId, setWorkingAssessmentId] = useState<
    string | undefined
  >(initialAssessmentId);
  const setupQuery = useReadinessStatusQuery(workingAssessmentId ?? "");
  const setupState =
    setupQuery.data?.kind === API_OUTCOME_KINDS.loaded
      ? setupQuery.data.data.repositorySetup
      : undefined;
  const repositories = setupState?.repositories ?? [];
  const allRepositoriesPinned =
    repositories.length > 0 &&
    repositories.every((repository) => repository.snapshot !== null);
  const savedConnection = setupState?.connection;
  const savedAnswer = deriveRepositorySetupAnswer(savedConnection ?? null);
  const [submitErrorKey, setSubmitErrorKey] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAddingRepository, setIsAddingRepository] = useState(false);
  const [reviewVisible, setReviewVisible] = useState(false);
  const [confirmingScope, setConfirmingScope] = useState(false);
  const [credentialDialogOpen, setCredentialDialogOpen] = useState(false);
  const [credentialDialogMode, setCredentialDialogMode] =
    useState<ProviderCredentialDialogMode>(
      PROVIDER_CREDENTIAL_DIALOG_MODES.connect,
    );
  const [confirmAccessOpen, setConfirmAccessOpen] = useState(false);
  const [pendingReauthRetry, setPendingReauthRetry] = useState<
    (() => void) | null
  >(null);
  const [confirmAccessMfaError, setConfirmAccessMfaError] = useState<{
    titleKey: MessageKey;
    detailKey: MessageKey;
  } | null>(null);
  const [confirmAccessPasswordError, setConfirmAccessPasswordError] = useState<{
    titleKey: MessageKey;
    detailKey: MessageKey;
  } | null>(null);
  const profile = profileQuery.data;

  const form = useForm<RepositorySetupFormData>({
    resolver: zodResolver(repositorySetupSchema),
    defaultValues: { provider: undefined, repositoryUrl: "" },
  });
  const provider = useWatch({ control: form.control, name: "provider" }) as
    GitProviderValue | undefined;
  const repositoryUrl =
    useWatch({ control: form.control, name: "repositoryUrl" }) ?? "";
  const credentialProvider = toCredentialProvider(provider);
  const activeCredentialStatus = credentialStatuses.data?.find(
    (status) => status.provider === credentialProvider,
  );
  const credentialConfigured = activeCredentialStatus?.configured === true;
  const canEnterRepository = Boolean(
    provider && credentialProvider && credentialConfigured,
  );
  const validationErrorKey =
    form.formState.errors.repositoryUrl || form.formState.errors.provider
      ? "pages.assessmentFlow.errors.repositoryUrl"
      : undefined;
  const activeErrorKey = validationErrorKey ?? submitErrorKey;

  function closeConfirmAccessDialog(cancelled = true) {
    if (cancelled) setPendingReauthRetry(null);
    setConfirmAccessOpen(false);
    setConfirmAccessMfaError(null);
    setConfirmAccessPasswordError(null);
  }

  async function handleConfirmAccessPasswordSubmit(values: {
    password: string;
  }) {
    if (!pendingReauthRetry) return;
    setConfirmAccessPasswordError(null);
    const outcome = await passwordReauthMutation
      .mutateAsync(values)
      .catch(() => ({
        kind: API_OUTCOME_KINDS.error,
        titleKey: "pages.signIn.errors.requestFailedTitle" as const,
        detailKey: "pages.signIn.errors.requestFailedDetail" as const,
      }));
    if (outcome.kind === API_OUTCOME_KINDS.invalid) {
      setConfirmAccessPasswordError({
        titleKey: "auth.errors.invalidCredentials.title",
        detailKey: "auth.errors.invalidCredentials.detail",
      });
      return;
    }
    if (outcome.kind === API_OUTCOME_KINDS.sessionInvalid) {
      setConfirmAccessPasswordError({
        titleKey: "auth.errors.sessionInvalid.title",
        detailKey: "auth.errors.sessionInvalid.detail",
      });
      return;
    }
    if (outcome.kind === API_OUTCOME_KINDS.error) {
      setConfirmAccessPasswordError({
        titleKey: outcome.titleKey,
        detailKey: outcome.detailKey,
      });
      return;
    }
    const retry = pendingReauthRetry;
    setPendingReauthRetry(null);
    closeConfirmAccessDialog(false);
    retry();
  }

  async function handleConfirmAccessOtpSubmit(values: ConfirmAccessOtpValues) {
    setConfirmAccessMfaError(null);
    const outcome = await verifyMutation.mutateAsync(values).catch(() => ({
      kind: API_OUTCOME_KINDS.error,
      titleKey: "pages.mfaVerify.errors.requestFailedTitle" as const,
      detailKey: "pages.mfaVerify.errors.requestFailedDetail" as const,
    }));
    if (outcome.kind === API_OUTCOME_KINDS.verified) {
      await profileQuery.refetch();
      const retry = pendingReauthRetry;
      setPendingReauthRetry(null);
      closeConfirmAccessDialog(false);
      retry?.();
      return;
    }
    setConfirmAccessMfaError(
      outcome.kind === API_OUTCOME_KINDS.sessionInvalid
        ? {
            titleKey: "auth.errors.sessionInvalid.title",
            detailKey: "auth.errors.sessionInvalid.detail",
          }
        : outcome.kind === API_OUTCOME_KINDS.mfaRequired
          ? {
              titleKey: "auth.errors.mfaRequired.title",
              detailKey: "auth.errors.mfaRequired.detail",
            }
          : { titleKey: outcome.titleKey, detailKey: outcome.detailKey },
    );
  }

  async function runSetup(data?: RepositorySetupFormData) {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setSubmitErrorKey(undefined);
    let assessmentId = workingAssessmentId;
    try {
      if (!assessmentId) {
        if (!data) return;
        const outcome = await createAssessment.mutateAsync({
          name: assessmentNameFromUrl(data.repositoryUrl),
        });
        if (outcome.kind !== API_OUTCOME_KINDS.created) {
          setSubmitErrorKey("pages.assessmentFlow.errors.createAssessment");
          return;
        }
        assessmentId = outcome.assessmentId;
        setWorkingAssessmentId(assessmentId);
      }
      const persisted = await getRepositorySetupState(assessmentId);
      let connection = isAddingRepository
        ? null
        : (persisted.repositories?.find(
            (repository) => repository.snapshot === null,
          ) ?? persisted.connection);
      if (!connection) {
        if (!data) {
          setSubmitErrorKey("pages.assessmentFlow.errors.repositorySetup");
          return;
        }
        connection = await connectAssessmentRepository(
          assessmentId,
          data.repositoryUrl,
        );
      }
      const persistedRepository = persisted.repositories?.find(
        (repository) => repository.connectionId === connection?.connectionId,
      );
      const persistedSnapshot =
        persistedRepository?.snapshot ??
        (persisted.connection?.connectionId === connection.connectionId
          ? persisted.snapshot
          : null);
      if (isAddingRepository || !persistedSnapshot) {
        await pinRepositorySnapshot(assessmentId, {
          connectionId: connection.connectionId,
          branch: connection.defaultBranch,
        });
      }
      setIsAddingRepository(false);
      setReviewVisible(true);
    } catch (error) {
      // A missing response does not prove rollback. Keep the Assessment and
      // reconcile its persisted checkpoint before any subsequent write.
      setSubmitErrorKey(resolveRepositorySetupErrorKey(error));
    } finally {
      try {
        if (assessmentId) {
          await queryClient.invalidateQueries({
            queryKey: apiQueryKeys.assessment.readiness(assessmentId),
          });
        }
      } finally {
        setIsSubmitting(false);
      }
    }
  }
  const handleSubmit = form.handleSubmit((data) => runSetup(data));

  async function confirmRepositoryScope() {
    if (!workingAssessmentId || confirmingScope) return;
    setConfirmingScope(true);
    setSubmitErrorKey(undefined);
    try {
      await startAssessmentRepositoryAnalysis(workingAssessmentId);
      router.replace(`/assessments/${workingAssessmentId}`);
    } catch (error) {
      setSubmitErrorKey(resolveRepositorySetupErrorKey(error));
    } finally {
      setConfirmingScope(false);
      await queryClient.invalidateQueries({
        queryKey: apiQueryKeys.assessment.readiness(workingAssessmentId),
      });
    }
  }

  return (
    <main
      className="flex h-full min-h-0 flex-col"
      data-surface="repository-setup"
    >
      <AssessmentTranscript
        autoScrollKey={[provider, activeErrorKey].join(":")}
      >
        <RepositorySetupConversation
          provider={
            isAddingRepository ? provider : (savedAnswer?.provider ?? provider)
          }
          repositoryUrl={
            isAddingRepository
              ? isSubmitting
                ? repositoryUrl.trim()
                : undefined
              : (savedAnswer?.repositoryUrl ??
                (isSubmitting ? repositoryUrl.trim() : undefined))
          }
          providerCapabilities={setupState?.providerCapabilities}
          onProviderChange={(value) => {
            form.setValue("provider", value, { shouldValidate: true });
            form.setValue("repositoryUrl", "");
            form.clearErrors();
            setSubmitErrorKey(undefined);
          }}
          disabled={
            isSubmitting || (Boolean(savedConnection) && !isAddingRepository)
          }
          footer={
            (!savedConnection || isAddingRepository) &&
            provider &&
            credentialProvider &&
            !credentialConfigured ? (
              <TurnFooter
                actions={[
                  {
                    id: "configure-provider",
                    label: t("pages.assessmentFlow.configureProvider"),
                    onSelect: () => {
                      setCredentialDialogMode(
                        PROVIDER_CREDENTIAL_DIALOG_MODES.connect,
                      );
                      setCredentialDialogOpen(true);
                    },
                  },
                ]}
              />
            ) : undefined
          }
        />
        {setupState?.repositories && setupState.repositories.length > 1 ? (
          <RepositoryMapTurn
            assessmentId={workingAssessmentId ?? ""}
            repositories={setupState.repositories}
            relations={setupState.relations ?? []}
            onEditRepository={(repository) => {
              form.reset({
                provider: repository.provider as GitProviderValue,
                repositoryUrl: repositoryUrlForEdit(
                  repository.provider,
                  repository.repositoryFullName,
                ),
              });
              setIsAddingRepository(true);
            }}
            onChanged={() => {
              if (workingAssessmentId)
                void queryClient.invalidateQueries({
                  queryKey:
                    apiQueryKeys.assessment.readiness(workingAssessmentId),
                });
            }}
          />
        ) : null}
        {reviewVisible && allRepositoriesPinned ? (
          <RepositoryReviewTurn
            repositories={repositories}
            relations={setupState?.relations ?? []}
            confirming={confirmingScope}
            onConfirm={() => void confirmRepositoryScope()}
            onBack={() => setReviewVisible(false)}
          />
        ) : null}
        {activeErrorKey ? (
          <AgentTurn>
            <Alert variant="destructive">
              <AlertTitle>{t("pages.assessmentFlow.errors.title")}</AlertTitle>
              <AlertDescription>{t(activeErrorKey)}</AlertDescription>
            </Alert>
          </AgentTurn>
        ) : null}
      </AssessmentTranscript>
      {savedConnection && !isAddingRepository && !reviewVisible ? (
        <div className="flex shrink-0 items-center justify-between gap-4 border-t p-4">
          <p className="text-sm text-muted-foreground">
            {t("pages.assessmentFlow.resumeSetupDescription")}
          </p>
          <div className="flex gap-2">
            <Button
              disabled={isSubmitting}
              onClick={() => {
                if (allRepositoriesPinned) {
                  setReviewVisible(true);
                } else {
                  void runSetup();
                }
              }}
            >
              {t(
                allRepositoriesPinned
                  ? "pages.assessmentFlow.multiRepository.reviewTitle"
                  : isSubmitting
                    ? "pages.assessmentFlow.resumingSetup"
                    : "pages.assessmentFlow.resumeSetup",
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => {
                setIsAddingRepository(true);
                form.reset({ provider: undefined, repositoryUrl: "" });
              }}
            >
              {t("pages.assessmentFlow.multiRepository.addRepository")}
            </Button>
          </div>
        </div>
      ) : (
        <AssessmentComposer
          value={repositoryUrl}
          onValueChange={(value) => {
            form.setValue("repositoryUrl", value);
            if (submitErrorKey) setSubmitErrorKey(undefined);
          }}
          onSubmit={handleSubmit}
          disabled={
            !canEnterRepository || Boolean(workingAssessmentId && !setupState)
          }
          submitting={isSubmitting}
          placeholder={t(
            canEnterRepository
              ? "pages.assessmentFlow.repositoryPlaceholder"
              : "pages.assessmentFlow.repositoryDisabledPlaceholder",
          )}
        />
      )}
      {workingAssessmentId && !setupState && !setupQuery.isFetching ? (
        <Button variant="outline" onClick={() => void setupQuery.refetch()}>
          {t("pages.assessmentFlow.retrySetupState")}
        </Button>
      ) : null}
      {credentialProvider ? (
        <ProviderCredentialDialog
          mode={credentialDialogMode}
          onModeChange={setCredentialDialogMode}
          onOpenChange={setCredentialDialogOpen}
          onReauthenticate={(retry) => {
            setPendingReauthRetry(() => retry);
            setConfirmAccessPasswordError(null);
            setConfirmAccessMfaError(null);
            setConfirmAccessOpen(true);
          }}
          open={credentialDialogOpen}
          provider={credentialProvider}
          status={activeCredentialStatus ?? null}
        />
      ) : null}
      {profile ? (
        <ConfirmAccessDialog
          open={confirmAccessOpen}
          onOpenChange={(open) => {
            if (open) setConfirmAccessOpen(true);
            else closeConfirmAccessDialog(true);
          }}
          onPasswordSubmit={handleConfirmAccessPasswordSubmit}
          accountLabelKey="pages.workspace.settingsHub.reauth.accountLabel"
          accountHandle={profile.email}
          avatarFallback={profile.email.slice(0, 1).toUpperCase()}
          titleKey="pages.workspace.settingsHub.reauth.title"
          descriptionKey="pages.workspace.settingsHub.reauth.description"
          passwordLabelKey="pages.signIn.passwordLabel"
          passwordPlaceholderKey="pages.workspace.settingsHub.reauth.passwordPlaceholder"
          forgotPasswordHref={API_REDIRECT_LOCATIONS.recoveryRequest}
          forgotPasswordLabelKey="pages.signIn.forgotPassword"
          supportTitleKey="pages.workspace.settingsHub.reauth.supportTitle"
          confirmLabelKey="pages.workspace.settingsHub.reauth.confirm"
          confirmingLabelKey="pages.workspace.settingsHub.reauth.confirming"
          closeLabelKey="pages.workspace.settingsHub.reauth.close"
          errorTitleKey={confirmAccessPasswordError?.titleKey}
          errorKey={confirmAccessPasswordError?.detailKey ?? null}
          mfa={{
            isEnabled: profile.mfa_enrolled,
            isConfigured: profile.mfa_enrolled,
            onSubmit: handleConfirmAccessOtpSubmit,
            otpLabelKey: "pages.mfaVerify.otpLabel",
            otpDescriptionKey: "pages.mfaVerify.otpDescription",
            otpPlaceholderKey:
              "pages.workspace.settingsHub.reauth.otpPlaceholder",
            verifyLabelKey: "pages.workspace.settingsHub.reauth.verify",
            verifyingLabelKey: "pages.workspace.settingsHub.reauth.verifying",
            switchToMfaLabelKey: profile.mfa_enrolled
              ? "pages.workspace.settingsHub.reauth.useAuthenticator"
              : "pages.workspace.settingsHub.reauth.setUpMfa",
            switchToPasswordLabelKey:
              "pages.workspace.settingsHub.reauth.usePassword",
            onSetupRequest: () => router.push(API_REDIRECT_LOCATIONS.mfaEnroll),
            errorTitleKey: confirmAccessMfaError?.titleKey,
            errorKey: confirmAccessMfaError?.detailKey ?? null,
          }}
        />
      ) : null}
    </main>
  );
}

function resolveRepositorySetupErrorKey(error: unknown): string {
  if (error instanceof Error) {
    const code = error.message;
    if (
      code === GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid ||
      code === GITHUB_CREDENTIAL_ERROR_CODES.credentialExpired ||
      code === GITHUB_CREDENTIAL_ERROR_CODES.credentialRequired
    ) {
      return "pages.workspace.settingsHub.repositories.credentialInvalidDescription";
    }
    if (
      code === GITHUB_CREDENTIAL_ERROR_CODES.repositoryAccessDenied ||
      code === GITHUB_CREDENTIAL_ERROR_CODES.repositoryUnavailable
    ) {
      return "pages.workspace.settingsHub.repositories.repositoryDeniedDescription";
    }
    if (code === GITHUB_CREDENTIAL_ERROR_CODES.credentialApprovalRequired) {
      return "pages.workspace.settingsHub.repositories.approvalRequiredDescription";
    }
    if (
      code === GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable ||
      code === GITHUB_INTEGRATION_ERROR_CODES.cliConnectDisabled
    ) {
      return "pages.workspace.settingsHub.repositories.serviceUnavailableDescription";
    }
  }
  return "pages.assessmentFlow.errors.repositorySetup";
}

function toCredentialProvider(
  provider?: AssessmentRepositoryProvider,
): CredentialProvider | undefined {
  return Object.values(CREDENTIAL_PROVIDERS).find(
    (value) => value === provider,
  );
}

function assessmentNameFromUrl(repositoryUrl: string) {
  const pathname = new URL(repositoryUrl).pathname
    .replace(/\/$/u, "")
    .replace(/\.git$/u, "");
  return pathname.split("/").filter(Boolean).slice(-2).join("/");
}

function repositoryUrlForEdit(provider: string, repositoryFullName: string) {
  const host =
    provider === "GITLAB"
      ? "gitlab.com"
      : provider === "BITBUCKET"
        ? "bitbucket.org"
        : provider === "AZURE_DEVOPS"
          ? "dev.azure.com"
          : "github.com";
  return `https://${host}/${repositoryFullName}`;
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
