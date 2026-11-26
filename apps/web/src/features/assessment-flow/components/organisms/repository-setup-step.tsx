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

import {
  repositorySetupSchema,
  type RepositorySetupFormData,
} from "../../schemas/repository-setup.schema";
import type { GitProviderValue } from "../../types/assessment-flow.types";
import { deriveRepositorySetupAnswer } from "../../utils/repository-setup-history";
import { RepositorySetupConversation } from "./repository-setup-conversation";

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
  const handleSubmit = form.handleSubmit((data) => runSetup(data));

  return (
    <main
      className="flex h-full min-h-0 flex-col"
      data-surface="repository-setup"
    >
      <AssessmentTranscript
        autoScrollKey={[provider, activeErrorKey].join(":")}
      >
        <RepositorySetupConversation
          provider={savedAnswer?.provider ?? provider}
          repositoryUrl={
            savedAnswer?.repositoryUrl ??
            (isSubmitting ? repositoryUrl.trim() : undefined)
          }
          onProviderChange={(value) => {
            form.setValue("provider", value, { shouldValidate: true });
            form.setValue("repositoryUrl", "");
            form.clearErrors();
            setSubmitErrorKey(undefined);
          }}
          disabled={isSubmitting || Boolean(savedConnection)}
          providerAvailability={Object.fromEntries(
            (credentialStatuses.data ?? []).map((status) => [
              status.provider,
              (status.enabled ??
                (status.provider === CREDENTIAL_PROVIDERS.github ||
                  status.provider === CREDENTIAL_PROVIDERS.gitlab)) &&
                status.available !== false,
            ]),
          )}
          providerTemporarilyUnavailable={Object.fromEntries(
            (credentialStatuses.data ?? []).map((status) => [
              status.provider,
              status.enabled === true && status.available === false,
            ]),
          )}
          footer={
            !savedConnection &&
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
        {waitingForRules ? (
          <AgentTurn>
            <Alert role="status">
              <AlertTitle>
                {t("pages.assessmentFlow.waitingForRulesTitle")}
              </AlertTitle>
              <AlertDescription>
                {t("pages.assessmentFlow.waitingForRulesDescription")}
              </AlertDescription>
            </Alert>
          </AgentTurn>
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
      {savedConnection ? (
        <div className="flex shrink-0 items-center justify-between gap-4 border-t p-4">
          <p className="text-sm text-muted-foreground">
            {t("pages.assessmentFlow.resumeSetupDescription")}
          </p>
          <Button disabled={isSubmitting} onClick={() => void runSetup()}>
            {t(
              isSubmitting
                ? "pages.assessmentFlow.resumingSetup"
                : "pages.assessmentFlow.resumeSetup",
            )}
          </Button>
          {savedAnswer ? (
            <Button
              variant="outline"
              disabled={isSubmitting}
              onClick={() => void runSetup(savedAnswer, true)}
            >
              {t("pages.assessmentFlow.reauthorizeRepository")}
            </Button>
          ) : null}
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
