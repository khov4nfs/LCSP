"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import {
  ASSESSMENT_LIFECYCLE_STATES,
  type AssessmentRepositoryProvider,
} from "@lcsp/contracts/assessment";
import {
  CREDENTIAL_PROVIDERS,
  GITHUB_CREDENTIAL_ERROR_CODES,
  GITHUB_INTEGRATION_ERROR_CODES,
  parseAzureDevOpsRepositoryUrl,
  parseBitbucketRepositoryUrl,
  parseGitHubRepositoryUrl,
  parseGitLabRepositoryUrl,
  type CredentialProvider,
} from "@lcsp/contracts/github-integration";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { resolveGitProviderLabel } from "@/components/molecules/git-provider-identity";
import { ConfirmAccessDialog } from "@/components/organisms/confirm-access-dialog";
import type { ConfirmAccessOtpValues } from "@/components/schemas/confirm-access-dialog.schema";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  PROVIDER_CREDENTIAL_DIALOG_MODES,
  ProviderCredentialDialog,
  type ProviderCredentialDialogMode,
} from "@/features/settings/components/molecules/provider-credential-dialog";
import {
  useRepositorySetupQuery,
  assessmentDomainKeys,
} from "@/lib/api/assessment-domain-queries";
import {
  useAuthSettingsProfileQuery,
  useMfaVerifyMutation,
  usePasswordReauthMutation,
} from "@/lib/api/auth-queries";
import { useProviderCredentialStatusesQuery } from "@/lib/api/github-repository-queries";
import {
  GitHubRepositoryRequestError,
  githubRepositoryProblemMessageKey,
} from "@/lib/api/github-repository-client";
import {
  connectAssessmentRepository,
  getRepositorySetupState,
  startRepositoryAnalysis,
} from "@/lib/api/repository-analysis-client";
import {
  API_OUTCOME_KINDS,
  API_REDIRECT_LOCATIONS,
} from "@/lib/api/outcome-kinds";
import { useCreateAssessmentMutation } from "@/lib/api/workspace-queries";
import { appLocale } from "@/lib/locale";

import { GIT_PROVIDER_OPTIONS } from "../../config/git-provider-options";
import {
  repositorySetupSchema,
  type RepositorySetupFormData,
} from "../../schemas/repository-setup.schema";
import type { GitProviderValue } from "../../types/assessment-flow.types";
import { deriveRepositorySetupAnswer } from "../../utils/repository-setup-history";
import { GitProviderCard } from "../molecules/git-provider-card";
import { RepositoryPicker } from "../molecules/repository-picker";
import { SecureConnectionForm } from "../molecules/secure-connection-form";
import {
  SetupStatusPanel,
  SETUP_STATUS_ROW_TONES,
  type SetupStatusRowItem,
} from "../molecules/setup-status-panel";
import {
  SETUP_STEP_STATES,
  type SetupStepperItem,
} from "../molecules/setup-stepper";
import {
  RepositorySetupLayout,
  SETUP_HEADER_TONES,
  SUMMARY_STATUS_TONES,
} from "./repository-setup-layout";

const WIZARD_STEPS = {
  provider: "provider",
  connection: "connection",
  repository: "repository",
} as const;

type WizardStep = (typeof WIZARD_STEPS)[keyof typeof WIZARD_STEPS];

type RepositorySetupStepProps = {
  assessmentId?: string;
};

/**
 * Business purpose: Guide an authorized customer through provider selection, credential setup and direct repository onboarding.
 * Business rules: GitHub/GitLab preserve current behavior; Bitbucket/Azure require backend readiness and an active owner credential, and reconnection is an explicit action.
 * Execution flow: 1. Load safe provider readiness and persisted setup. 2. Validate a provider-matched URL and credential state. 3. Connect/reconnect and prepare the pinned repository through existing mutations.
 * Failure cases: Unavailable providers, invalid credentials, URL mismatches and setup errors stop submission while preserving the existing assessment checkpoint.
 * Side effects: May configure a credential, connect a repository, start preparation, update query caches and navigate after the backend activates the assessment.
 */
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
  const setupQuery = useRepositorySetupQuery(workingAssessmentId ?? "");
  const setupState = setupQuery.data;
  const savedConnection = setupState?.connection;
  const savedAnswer = deriveRepositorySetupAnswer(savedConnection ?? null);
  const [submitErrorKey, setSubmitErrorKey] = useState<string>();
  const [waitingForRules, setWaitingForRules] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
  const providerEnabled =
    provider === CREDENTIAL_PROVIDERS.github ||
    provider === CREDENTIAL_PROVIDERS.gitlab ||
    (activeCredentialStatus?.enabled === true &&
      activeCredentialStatus.available !== false);
  const canEnterRepository = Boolean(
    provider && credentialProvider && credentialConfigured && providerEnabled,
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

  /**
   * Business purpose: Save a customer's repository input and advance only when the assessment is activated.
   * Business rules:
   * - Reuse persisted assessments, connections and snapshots on retries; never delete a saved checkpoint.
   * - Reauthorize a connection only after the customer selects the explicit reconnection action.
   * - A successful completion that remains PREPARING waits for approved compliance rules and must not navigate as if active.
   * Execution flow:
   * 1. Create an assessment only when needed and reconcile its repository connection.
   * 2. Complete repository preparation and show the legal-input prerequisite or navigate after activation.
   * 3. Refresh both setup and assessment detail so a same-route retry can leave the PREPARING view.
   * Failure cases:
   * - Connection, validation and preparation errors preserve saved inputs and show the mapped error for retry.
   * Side effects:
   * - May create assessment/repository records through the API, update query caches and navigate to an activated assessment.
   */
  async function runSetup(
    data?: RepositorySetupFormData,
    forceReauthorization = false,
  ) {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setSubmitErrorKey(undefined);
    setWaitingForRules(false);
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
      let connection = persisted.connection;
      if (!connection || forceReauthorization) {
        if (!data) {
          setSubmitErrorKey("pages.assessmentFlow.errors.repositorySetup");
          return;
        }
        connection = await connectAssessmentRepository(
          assessmentId,
          data.repositoryUrl,
          forceReauthorization,
        );
      }
      const result = await startRepositoryAnalysis(assessmentId, {
        connectionId: connection.connectionId,
        branch: connection.defaultBranch,
        sourcePathPrefix: null,
      });
      if (result.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.PREPARING) {
        setWaitingForRules(true);
        return;
      }
      router.replace(`/assessments/${assessmentId}`);
    } catch (error) {
      // A missing response does not prove rollback. Keep the Assessment and
      // reconcile its persisted checkpoint before any subsequent write.
      setSubmitErrorKey(resolveRepositorySetupErrorKey(error));
    } finally {
      try {
        if (assessmentId) {
          await Promise.all([
            queryClient.invalidateQueries({
              queryKey: assessmentDomainKeys.setup(assessmentId),
            }),
            queryClient.invalidateQueries({
              queryKey: assessmentDomainKeys.detail(assessmentId),
            }),
          ]);
        }
      } finally {
        setIsSubmitting(false);
      }
    }
  }
  const [wizardStep, setWizardStep] = useState<WizardStep>(WIZARD_STEPS.provider);
  const handleSubmit = form.handleSubmit((data) => runSetup(data));

  const providerAvailability = Object.fromEntries(
    (credentialStatuses.data ?? []).map((status) => [
      status.provider,
      (status.enabled ??
        (status.provider === CREDENTIAL_PROVIDERS.github ||
          status.provider === CREDENTIAL_PROVIDERS.gitlab)) &&
        status.available !== false,
    ]),
  );

  const selectedProvider =
    (savedAnswer?.provider as AssessmentRepositoryProvider | undefined) ??
    (provider ? (provider as AssessmentRepositoryProvider) : null);

  const selectedProviderEnabled = selectedProvider
    ? (providerAvailability[toCredentialProvider(selectedProvider) ?? ""] ??
      providerEnabled)
    : false;

  const isStatusView =
    Boolean(savedConnection) || waitingForRules || isSubmitting;
  const hasSetupError = Boolean(activeErrorKey);

  const stepperItems: SetupStepperItem[] = [
    {
      id: "provider",
      label: t("pages.assessmentFlow.stepper.step1"),
      state:
        isStatusView ||
        (selectedProvider && wizardStep !== WIZARD_STEPS.provider)
          ? SETUP_STEP_STATES.complete
          : SETUP_STEP_STATES.current,
    },
    {
      id: "connection",
      label: t("pages.assessmentFlow.stepper.step2"),
      state:
        isStatusView ||
        (wizardStep === WIZARD_STEPS.repository && credentialConfigured)
          ? SETUP_STEP_STATES.complete
          : wizardStep === WIZARD_STEPS.connection
            ? SETUP_STEP_STATES.current
            : SETUP_STEP_STATES.upcoming,
    },
    {
      id: "repository",
      label: t("pages.assessmentFlow.stepper.step3"),
      state: isStatusView
        ? SETUP_STEP_STATES.complete
        : wizardStep === WIZARD_STEPS.repository
          ? SETUP_STEP_STATES.current
          : SETUP_STEP_STATES.upcoming,
    },
    {
      id: "activation",
      label: t("pages.assessmentFlow.stepper.step4"),
      state: isStatusView
        ? hasSetupError
          ? SETUP_STEP_STATES.attention
          : SETUP_STEP_STATES.current
        : SETUP_STEP_STATES.upcoming,
    },
  ];

  const statusRows: SetupStatusRowItem[] = isStatusView
    ? [
        {
          id: "connection-saved",
          label: t("pages.assessmentFlow.statusRows.connectionSaved"),
          context: selectedProvider
            ? resolveGitProviderLabel(selectedProvider)
            : t("pages.assessmentFlow.summary.providerUnselected"),
          badgeLabel: t("pages.assessmentFlow.statusRows.doneBadge"),
          tone: SETUP_STATUS_ROW_TONES.success,
        },
        {
          id: "source-checkpoint",
          label: isSubmitting
            ? t("pages.assessmentFlow.statusRows.pinningSource")
            : t("pages.assessmentFlow.statusRows.sourceRetained"),
          context:
            savedAnswer?.repositoryUrl ??
            (repositoryUrl.trim() ||
              t("pages.assessmentFlow.summary.repositoryUnselected")),
          badgeLabel: isSubmitting
            ? t("pages.assessmentFlow.statusRows.inProgressBadge")
            : t("pages.assessmentFlow.statusRows.doneBadge"),
          tone: isSubmitting
            ? SETUP_STATUS_ROW_TONES.info
            : SETUP_STATUS_ROW_TONES.success,
        },
        {
          id: "rules-check",
          label: hasSetupError
            ? t("pages.assessmentFlow.statusRows.setupFailed")
            : waitingForRules
              ? t("pages.assessmentFlow.statusRows.rulesWaiting")
              : t("pages.assessmentFlow.statusRows.checkingAccess"),
          context: hasSetupError
            ? t(activeErrorKey!)
            : waitingForRules
              ? t("pages.assessmentFlow.waitingForRulesDescription")
              : t("pages.assessmentFlow.stepTitles.connectingSubtitle"),
          badgeLabel: hasSetupError
            ? t("pages.assessmentFlow.statusRows.failedBadge")
            : waitingForRules
              ? t("pages.assessmentFlow.statusRows.waitingBadge")
              : t("pages.assessmentFlow.statusRows.inProgressBadge"),
          tone: hasSetupError
            ? SETUP_STATUS_ROW_TONES.danger
            : waitingForRules
              ? SETUP_STATUS_ROW_TONES.warning
              : SETUP_STATUS_ROW_TONES.info,
        },
      ]
    : [];

  const providerLabel = selectedProvider
    ? resolveGitProviderLabel(selectedProvider)
    : t("pages.assessmentFlow.providers.github");

  const stepTitle = isStatusView
    ? hasSetupError
      ? t("pages.assessmentFlow.stepTitles.failedTitle")
      : waitingForRules
        ? t("pages.assessmentFlow.waitingForRulesTitle")
        : isSubmitting
          ? t("pages.assessmentFlow.stepTitles.connectingTitle")
          : t("pages.assessmentFlow.resumeSetup")
    : wizardStep === WIZARD_STEPS.connection
      ? resolveMessage(
          appLocale,
          "pages.assessmentFlow.stepTitles.secureConnectionTitle",
        ).replace("{provider}", providerLabel)
      : wizardStep === WIZARD_STEPS.repository
        ? t("pages.assessmentFlow.stepTitles.chooseRepositoryTitle")
        : t("pages.assessmentFlow.stepTitles.chooseProviderTitle");

  const stepSubtitle = isStatusView
    ? hasSetupError
      ? t("pages.assessmentFlow.stepTitles.failedSubtitle")
      : waitingForRules
        ? t("pages.assessmentFlow.waitingForRulesDescription")
        : isSubmitting
          ? t("pages.assessmentFlow.stepTitles.connectingSubtitle")
          : t("pages.assessmentFlow.resumeSetupDescription")
    : wizardStep === WIZARD_STEPS.connection
      ? resolveMessage(
          appLocale,
          "pages.assessmentFlow.stepTitles.secureConnectionSubtitle",
        ).replace("{provider}", providerLabel)
      : wizardStep === WIZARD_STEPS.repository
        ? resolveMessage(
            appLocale,
            "pages.assessmentFlow.stepTitles.chooseRepositorySubtitle",
          ).replace("{provider}", providerLabel)
        : t("pages.assessmentFlow.stepTitles.chooseProviderSubtitle");

  const summaryStatusLabel = hasSetupError
    ? t("pages.assessmentFlow.summary.statusAttention")
    : waitingForRules
      ? t("pages.assessmentFlow.summary.statusWaiting")
      : t("pages.assessmentFlow.summary.statusPreparing");

  const summaryStatusTone = hasSetupError
    ? SUMMARY_STATUS_TONES.danger
    : waitingForRules
      ? SUMMARY_STATUS_TONES.warning
      : SUMMARY_STATUS_TONES.info;

  const assessmentTitle =
    assessmentNameFromUrl(
      savedAnswer?.repositoryUrl ?? repositoryUrl.trim(),
    ) ?? t("pages.assessmentFlow.setupPageTitle");

  return (
    <main
      className="flex h-full min-h-0 flex-col overflow-y-auto"
      data-surface="repository-setup"
    >
      <RepositorySetupLayout
        steps={stepperItems}
        onStepSelect={
          isStatusView
            ? undefined
            : (stepId) => {
                if (stepId === "provider") {
                  setWizardStep(WIZARD_STEPS.provider);
                } else if (stepId === "connection") {
                  setWizardStep(WIZARD_STEPS.connection);
                }
              }
        }
        stepTitle={stepTitle}
        stepSubtitle={stepSubtitle}
        headerTone={
          isStatusView && hasSetupError
            ? SETUP_HEADER_TONES.danger
            : SETUP_HEADER_TONES.brand
        }
        assessmentTitle={assessmentTitle}
        summaryStatusLabel={summaryStatusLabel}
        summaryStatusTone={summaryStatusTone}
        provider={selectedProvider}
        repositoryLabel={
          savedAnswer?.repositoryUrl ?? (repositoryUrl.trim() || null)
        }
        rulesLabel={
          waitingForRules
            ? t("pages.assessmentFlow.summary.rulesBlocked")
            : t("pages.assessmentFlow.summary.rulesPending")
        }
      >
        <div className="space-y-4">
          {activeErrorKey && !isStatusView ? (
            <Alert variant="destructive">
              <AlertTitle>{t("pages.assessmentFlow.errors.title")}</AlertTitle>
              <AlertDescription>{t(activeErrorKey)}</AlertDescription>
            </Alert>
          ) : null}

          {isStatusView ? (
            <div className="space-y-4">
              <SetupStatusPanel
                rows={statusRows}
                noticeTitle={
                  hasSetupError
                    ? t("pages.assessmentFlow.statusRows.retrySafeNoticeTitle")
                    : undefined
                }
                noticeBody={
                  hasSetupError
                    ? t("pages.assessmentFlow.statusRows.retrySafeNoticeBody")
                    : undefined
                }
                noticeTone={
                  hasSetupError
                    ? SETUP_STATUS_ROW_TONES.warning
                    : SETUP_STATUS_ROW_TONES.info
                }
              />

              <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
                {savedConnection ? (
                  <Button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => void runSetup()}
                  >
                    {t(
                      isSubmitting
                        ? "pages.assessmentFlow.resumingSetup"
                        : hasSetupError
                          ? "pages.assessmentFlow.actions.retrySafe"
                          : "pages.assessmentFlow.resumeSetup",
                    )}
                  </Button>
                ) : null}
                {savedAnswer ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isSubmitting}
                    onClick={() => void runSetup(savedAnswer, true)}
                  >
                    {t("pages.assessmentFlow.reauthorizeRepository")}
                  </Button>
                ) : null}
                {workingAssessmentId && !setupState && !setupQuery.isFetching ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void setupQuery.refetch()}
                  >
                    {t("pages.assessmentFlow.retrySetupState")}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={() => router.push("/assessments")}
                >
                  {t("pages.assessmentFlow.actions.back")}
                </Button>
              </div>
            </div>
          ) : wizardStep === WIZARD_STEPS.connection && selectedProvider ? (
            <SecureConnectionForm
              provider={selectedProvider}
              connected={credentialConfigured}
              previewOnly={!selectedProviderEnabled}
              onConfigureCredential={() => {
                setCredentialDialogMode(PROVIDER_CREDENTIAL_DIALOG_MODES.connect);
                setCredentialDialogOpen(true);
              }}
              onContinue={() => setWizardStep(WIZARD_STEPS.repository)}
              onBack={() => setWizardStep(WIZARD_STEPS.provider)}
            />
          ) : wizardStep === WIZARD_STEPS.repository && selectedProvider ? (
            <form onSubmit={handleSubmit}>
              <RepositoryPicker
                control={form.control}
                provider={selectedProvider}
                connected={credentialConfigured}
                previewOnly={!selectedProviderEnabled}
                canEnterRepository={
                  canEnterRepository &&
                  !(Boolean(workingAssessmentId) && !setupState)
                }
                isSubmitting={isSubmitting}
                pinnedCommitSha={null}
                errorMessage={
                  form.formState.errors.repositoryUrl?.message
                    ? t("pages.assessmentFlow.errors.repositoryUrl")
                    : undefined
                }
                onManageCredential={() => {
                  setCredentialDialogMode(
                    PROVIDER_CREDENTIAL_DIALOG_MODES.connect,
                  );
                  setCredentialDialogOpen(true);
                }}
                onBack={() => setWizardStep(WIZARD_STEPS.connection)}
              />
            </form>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {GIT_PROVIDER_OPTIONS.map((option) => {
                  const credProvider = toCredentialProvider(option.id);
                  const status = credProvider
                    ? credentialStatuses.data?.find(
                        (item) => item.provider === credProvider,
                      )
                    : undefined;
                  const enabled = credProvider
                    ? (providerAvailability[credProvider] ?? false)
                    : false;
                  const connected = Boolean(status?.configured);

                  return (
                    <GitProviderCard
                      key={option.id}
                      provider={option.id}
                      hostname={option.hostname}
                      selected={selectedProvider === option.id}
                      connected={connected}
                      enabled={enabled}
                      onSelect={(nextProvider) => {
                        form.setValue("provider", nextProvider, {
                          shouldValidate: true,
                        });
                        form.setValue("repositoryUrl", "");
                        form.clearErrors();
                        setSubmitErrorKey(undefined);
                      }}
                    />
                  );
                })}
              </div>

              {selectedProvider && !selectedProviderEnabled ? (
                <p className="rounded-lg border border-status-warning-border bg-status-warning-bg px-3.5 py-2.5 text-xs text-status-warning">
                  {t("pages.assessmentFlow.providerCard.previewNotice")}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
                <Button
                  type="button"
                  disabled={!selectedProvider || !selectedProviderEnabled}
                  onClick={() =>
                    setWizardStep(
                      credentialConfigured
                        ? WIZARD_STEPS.repository
                        : WIZARD_STEPS.connection,
                    )
                  }
                >
                  {t("pages.assessmentFlow.actions.continue")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push("/assessments")}
                >
                  {t("pages.assessmentFlow.actions.back")}
                </Button>
                {workingAssessmentId && !setupState && !setupQuery.isFetching ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void setupQuery.refetch()}
                  >
                    {t("pages.assessmentFlow.retrySetupState")}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={() => router.push("/assessments")}
                >
                  {t("pages.assessmentFlow.actions.back")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </RepositorySetupLayout>
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

/**
 * Business purpose: Map repository onboarding failures to localized corrective guidance.
 * Business rules: Provider problem categories take precedence over opaque exception messages; unknown errors retain the generic setup failure message.
 * Execution flow: 1. Map typed provider problems through the shared credential mapper. 2. Map known legacy setup codes. 3. Use the generic retry message.
 * Failure cases: Unrecognized details are not exposed to the customer.
 * Side effects: Pure error projection without logging provider response data.
 */
function resolveRepositorySetupErrorKey(error: unknown): string {
  if (error instanceof GitHubRepositoryRequestError) {
    return githubRepositoryProblemMessageKey(error);
  }
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

/**
 * Business purpose: Choose a readable initial assessment name from a validated provider repository locator.
 * Business rules: Names come from a recognized provider path; Azure excludes its routing-only `/_git/` segment and retains project/repository context.
 * Execution flow: 1. Parse the URL with each exact shared provider parser. 2. Select the canonical repository identity. 3. Use its final two identity components as the assessment label.
 * Failure cases: An invalid URL yields the neutral `repository` label; submission validation still rejects that URL before connection.
 * Side effects: Pure display-name derivation with no assessment mutation.
 */
function assessmentNameFromUrl(repositoryUrl: string) {
  const locator =
    parseGitHubRepositoryUrl(repositoryUrl) ??
    parseGitLabRepositoryUrl(repositoryUrl) ??
    parseBitbucketRepositoryUrl(repositoryUrl) ??
    parseAzureDevOpsRepositoryUrl(repositoryUrl);
  if (!locator) return "repository";
  return locator.repositoryFullName.split("/").slice(-2).join("/");
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
