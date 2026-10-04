"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import {
  ASSESSMENT_REPOSITORY_PROVIDERS,
  type AssessmentRepositoryProvider,
  type AssessmentRepositorySetupRepository,
} from "@lcsp/contracts/assessment";
import {
  CREDENTIAL_PROVIDERS,
  GITHUB_CREDENTIAL_ERROR_CODES,
  GITHUB_INTEGRATION_ERROR_CODES,
  type CredentialProvider,
} from "@lcsp/contracts/github-integration";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";

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
  removeAssessmentRepository,
  removeAssessmentRepositoryRelation,
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
import {
  REPOSITORY_ENTRY_INTENTS,
  type RepositoryEntryIntent,
} from "../../types/repository-setup-conversation.types";
import { RepositoryDetailsTurn } from "./repository-details-turn";
import { RepositoryMapTurn } from "./repository-map-turn";
import { RepositoryReviewTurn } from "./repository-review-turn";

type RepositorySetupStepProps = {
  assessmentId?: string;
};

const REPOSITORY_SETUP_STEPS = {
  repositoryEntry: "REPOSITORY_ENTRY",
  repositoryDetails: "REPOSITORY_DETAILS",
  repositoryReady: "REPOSITORY_READY",
  repositoryMap: "REPOSITORY_MAP",
  reviewScope: "REVIEW_SCOPE",
} as const;

type RepositorySetupStepState =
  (typeof REPOSITORY_SETUP_STEPS)[keyof typeof REPOSITORY_SETUP_STEPS];

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
  const [submitErrorKey, setSubmitErrorKey] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [setupStep, setSetupStep] = useState<RepositorySetupStepState>(
    REPOSITORY_SETUP_STEPS.repositoryEntry,
  );
  const [editingConnectionId, setEditingConnectionId] = useState<string>();
  const [entryReturnStep, setEntryReturnStep] = useState<
    RepositorySetupStepState | undefined
  >();
  const [entryIntent, setEntryIntent] = useState<RepositoryEntryIntent>(
    REPOSITORY_ENTRY_INTENTS.initial,
  );
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
    defaultValues: { provider: undefined, repositoryUrl: "", branch: "" },
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
  const displayedSetupStep =
    setupStep === REPOSITORY_SETUP_STEPS.repositoryEntry &&
    entryIntent === REPOSITORY_ENTRY_INTENTS.initial &&
    allRepositoriesPinned
      ? REPOSITORY_SETUP_STEPS.repositoryMap
      : setupStep;
  const isAddingRepository = entryIntent === REPOSITORY_ENTRY_INTENTS.add;
  const isEditingRepository = entryIntent === REPOSITORY_ENTRY_INTENTS.edit;
  // Adding from the repository map keeps the context table mounted and appends
  // the provider/repository form underneath it.
  const isInlineMapRepositoryEntry =
    displayedSetupStep === REPOSITORY_SETUP_STEPS.repositoryMap &&
    entryReturnStep === REPOSITORY_SETUP_STEPS.repositoryMap &&
    isAddingRepository;
  const isRepositoryEntryActive =
    displayedSetupStep === REPOSITORY_SETUP_STEPS.repositoryEntry ||
    isInlineMapRepositoryEntry;

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
      let connection =
        isAddingRepository || isEditingRepository
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
      if (isAddingRepository || isEditingRepository || !persistedSnapshot) {
        await pinRepositorySnapshot(assessmentId, {
          connectionId: connection.connectionId,
          branch: data?.branch || connection.defaultBranch,
        });
      }
      if (editingConnectionId) {
        const previousRepository = persisted.repositories?.find(
          (repository) => repository.connectionId === editingConnectionId,
        );
        const relationIds = (persisted.relations ?? [])
          .filter(
            (relation) =>
              relation.fromSnapshotId === previousRepository?.snapshot?.id ||
              relation.toSnapshotId === previousRepository?.snapshot?.id,
          )
          .map((relation) => relation.id);
        if (connection.connectionId === editingConnectionId) {
          await Promise.all(
            relationIds.map((relationId) =>
              removeAssessmentRepositoryRelation(assessmentId!, relationId),
            ),
          );
        } else {
          await removeAssessmentRepository(assessmentId, editingConnectionId);
        }
      }
      // Do not advance an Add action until the server checkpoint contains the
      // newly pinned connection. This keeps it distinct from an edit/replacement
      // when React Query is still showing the previous repository list.
      const refreshedSetup = await getRepositorySetupState(assessmentId);
      const refreshedRepositories = refreshedSetup.repositories ?? [];
      const addedRepository = refreshedRepositories.some(
        (repository) => repository.connectionId === connection.connectionId,
      );
      if (!addedRepository) {
        setSubmitErrorKey("pages.assessmentFlow.errors.repositorySetup");
        return;
      }
      setEditingConnectionId(undefined);
      setEntryIntent(REPOSITORY_ENTRY_INTENTS.initial);
      setSetupStep(
        refreshedRepositories.length > 0
          ? REPOSITORY_SETUP_STEPS.repositoryMap
          : REPOSITORY_SETUP_STEPS.repositoryReady,
      );
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
          await queryClient.refetchQueries({
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
      await startAssessmentRepositoryAnalysis(
        workingAssessmentId,
        setupState?.setupVersion ?? 0,
      );
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

  function beginRepositoryEntry(
    intent: RepositoryEntryIntent,
    returnStep: RepositorySetupStepState | undefined,
    repository?: AssessmentRepositorySetupRepository,
  ) {
    setEditingConnectionId(repository?.connectionId);
    setEntryIntent(intent);
    setEntryReturnStep(returnStep);
    setSetupStep(
      intent === REPOSITORY_ENTRY_INTENTS.add &&
        returnStep === REPOSITORY_SETUP_STEPS.repositoryMap
        ? REPOSITORY_SETUP_STEPS.repositoryMap
        : REPOSITORY_SETUP_STEPS.repositoryEntry,
    );
    setSubmitErrorKey(undefined);
    form.reset(
      repository
        ? {
            provider: repository.provider as GitProviderValue,
            repositoryUrl: repositoryUrlForEdit(
              repository.provider,
              repository.repositoryFullName,
            ),
            branch: repository.snapshot?.branch ?? repository.defaultBranch,
          }
        : { provider: undefined, repositoryUrl: "", branch: "" },
    );
  }

  function returnToRepositories() {
    const fallbackStep =
      repositories.length > 0
        ? REPOSITORY_SETUP_STEPS.repositoryMap
        : REPOSITORY_SETUP_STEPS.repositoryReady;
    setEditingConnectionId(undefined);
    setEntryIntent(REPOSITORY_ENTRY_INTENTS.initial);
    setEntryReturnStep(undefined);
    setSetupStep(entryReturnStep ?? fallbackStep);
    setSubmitErrorKey(undefined);
    form.reset({ provider: undefined, repositoryUrl: "", branch: "" });
  }

  function openCredentialDialog() {
    setCredentialDialogMode(PROVIDER_CREDENTIAL_DIALOG_MODES.connect);
    setCredentialDialogOpen(true);
  }

  const repositoryDetails = isRepositoryEntryActive ? (
    <RepositoryDetailsTurn
      provider={provider}
      providerCapabilities={setupState?.providerCapabilities}
      intent={entryIntent}
      repositoryPreview={repositoryPreviewFromUrl(repositoryUrl)}
      credentialConfigured={credentialConfigured}
      canSubmit={
        canEnterRepository && !Boolean(workingAssessmentId && !setupState)
      }
      submitting={isSubmitting}
      onSubmit={handleSubmit}
      onProviderChange={(value) => {
        const providerChanged = value !== provider;
        form.setValue("provider", value, { shouldValidate: true });
        if (providerChanged) form.setValue("repositoryUrl", "");
        form.clearErrors();
        setSubmitErrorKey(undefined);
      }}
      onBackToRepositories={
        entryIntent === REPOSITORY_ENTRY_INTENTS.initial
          ? undefined
          : returnToRepositories
      }
      onConfigureProvider={openCredentialDialog}
    />
  ) : null;

  return (
    <main
      className="flex h-full min-h-0 flex-col"
      data-surface="repository-setup"
    >
      <FormProvider {...form}>
        <AssessmentTranscript
          autoScrollKey={[displayedSetupStep, provider, activeErrorKey].join(
            ":",
          )}
        >
          {!isInlineMapRepositoryEntry ? repositoryDetails : null}
          {displayedSetupStep === REPOSITORY_SETUP_STEPS.repositoryReady &&
          allRepositoriesPinned ? (
            <RepositoryReadyTurn
              repository={repositories.at(-1)}
              onAddRepository={() =>
                beginRepositoryEntry(
                  REPOSITORY_ENTRY_INTENTS.add,
                  REPOSITORY_SETUP_STEPS.repositoryReady,
                )
              }
              onContinue={() =>
                setSetupStep(
                  repositories.length > 1
                    ? REPOSITORY_SETUP_STEPS.repositoryMap
                    : REPOSITORY_SETUP_STEPS.reviewScope,
                )
              }
              onEdit={() =>
                beginRepositoryEntry(
                  REPOSITORY_ENTRY_INTENTS.edit,
                  REPOSITORY_SETUP_STEPS.repositoryReady,
                  repositories.at(-1),
                )
              }
            />
          ) : null}
          {displayedSetupStep === REPOSITORY_SETUP_STEPS.repositoryMap &&
          setupState?.repositories &&
          setupState.repositories.length > 0 ? (
            <RepositoryMapTurn
              assessmentId={workingAssessmentId ?? ""}
              repositories={setupState.repositories}
              relations={setupState.relations ?? []}
              onEditRepository={(repository) =>
                beginRepositoryEntry(
                  REPOSITORY_ENTRY_INTENTS.edit,
                  REPOSITORY_SETUP_STEPS.repositoryMap,
                  repository,
                )
              }
              onAddRepository={() =>
                beginRepositoryEntry(
                  REPOSITORY_ENTRY_INTENTS.add,
                  REPOSITORY_SETUP_STEPS.repositoryMap,
                )
              }
              onRelationEditorOpen={() => {
                if (isInlineMapRepositoryEntry) returnToRepositories();
              }}
              repositoryEntryActive={isInlineMapRepositoryEntry}
              onReviewScope={() =>
                setSetupStep(REPOSITORY_SETUP_STEPS.reviewScope)
              }
              onChanged={() => {
                if (workingAssessmentId)
                  void queryClient.invalidateQueries({
                    queryKey:
                      apiQueryKeys.assessment.readiness(workingAssessmentId),
                  });
              }}
            />
          ) : null}
          {isInlineMapRepositoryEntry ? repositoryDetails : null}
          {displayedSetupStep === REPOSITORY_SETUP_STEPS.reviewScope &&
          allRepositoriesPinned ? (
            <RepositoryReviewTurn
              repositories={repositories}
              relations={setupState?.relations ?? []}
              confirming={confirmingScope}
              onConfirm={() => void confirmRepositoryScope()}
              onBack={() =>
                setSetupStep(
                  repositories.length > 0
                    ? REPOSITORY_SETUP_STEPS.repositoryMap
                    : REPOSITORY_SETUP_STEPS.repositoryReady,
                )
              }
              onEditMap={() =>
                setSetupStep(REPOSITORY_SETUP_STEPS.repositoryMap)
              }
              onAddRepository={() =>
                beginRepositoryEntry(
                  REPOSITORY_ENTRY_INTENTS.add,
                  REPOSITORY_SETUP_STEPS.reviewScope,
                )
              }
            />
          ) : null}
          {activeErrorKey ? (
            <AgentTurn>
              <Alert variant="destructive">
                <AlertTitle>
                  {t("pages.assessmentFlow.errors.title")}
                </AlertTitle>
                <AlertDescription>{t(activeErrorKey)}</AlertDescription>
              </Alert>
            </AgentTurn>
          ) : null}
        </AssessmentTranscript>
      </FormProvider>
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

function RepositoryReadyTurn({
  repository,
  onAddRepository,
  onContinue,
  onEdit,
}: {
  repository?: AssessmentRepositorySetupRepository;
  onAddRepository: () => void;
  onContinue: () => void;
  onEdit: () => void;
}) {
  if (!repository?.snapshot) return null;

  return (
    <AgentTurn>
      <p className="text-sm">
        {t("pages.assessmentFlow.repository.connectedDescription")}
      </p>
      <div className="mt-3 rounded-md border p-3 text-sm">
        <p className="font-medium">{repository.repositoryFullName}</p>
        <p className="mt-1 text-muted-foreground">
          {formatProvider(repository.provider)} &middot;{" "}
          {repository.snapshot.branch ?? repository.defaultBranch} &middot;{" "}
          {repository.snapshot.commitSha.slice(0, 12)}
        </p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" onClick={onContinue}>
          {t("pages.assessmentFlow.multiRepository.reviewTitle")}
        </Button>
        <Button type="button" variant="outline" onClick={onAddRepository}>
          {t("pages.assessmentFlow.multiRepository.addRepository")}
        </Button>
        <Button type="button" variant="outline" onClick={onEdit}>
          {t("pages.assessmentFlow.multiRepository.edit")}
        </Button>
      </div>
    </AgentTurn>
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

function repositoryPreviewFromUrl(repositoryUrl: string) {
  try {
    const pathname = new URL(repositoryUrl).pathname
      .replace(/\/$/u, "")
      .replace(/\.git$/u, "");
    const segments = pathname.split("/").filter(Boolean);
    return segments.length > 1 ? segments.slice(-2).join("/") : undefined;
  } catch {
    return undefined;
  }
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

function formatProvider(provider: string) {
  const key =
    provider === ASSESSMENT_REPOSITORY_PROVIDERS.github
      ? "github"
      : provider === ASSESSMENT_REPOSITORY_PROVIDERS.gitlab
        ? "gitlab"
        : provider === ASSESSMENT_REPOSITORY_PROVIDERS.bitbucket
          ? "bitbucket"
          : "azureDevOps";
  return t(`pages.assessmentFlow.providers.${key}`);
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
