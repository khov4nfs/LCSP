"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import {
  ASSESSMENT_LIFECYCLE_STATES,
  type AssessmentRepositoryProvider,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_REPOSITORY_LIMITS,
  REPOSITORY_SET_ERROR_CODES,
} from "@lcsp/contracts/assessment-domain";
import {
  CREDENTIAL_PROVIDERS,
  GITHUB_CREDENTIAL_ERROR_CODES,
  GITHUB_INTEGRATION_ERROR_CODES,
  type CredentialProvider,
} from "@lcsp/contracts/github-integration";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";

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
  useRemoveAssessmentRepositoryMutation,
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
  repositorySetupEntries,
  startRepositoryAnalysis,
  type StartRepositoryAnalysisInput,
} from "@/lib/api/repository-analysis-client";
import {
  API_OUTCOME_KINDS,
  API_REDIRECT_LOCATIONS,
} from "@/lib/api/outcome-kinds";
import { useCreateAssessmentMutation } from "@/lib/api/workspace-queries";
import { appLocale } from "@/lib/locale";

import { GIT_PROVIDER_OPTIONS } from "../../config/git-provider-options";
import {
  REPOSITORY_SETUP_ISSUE_MESSAGE_KEYS,
  REPOSITORY_SETUP_ISSUES,
} from "../../config/repository-setup-issues";
import {
  repositoryEntrySchema,
  repositorySetupSchema,
} from "../../schemas/repository-setup.schema";
import type { GitProviderValue } from "../../types/assessment-flow.types";
import type {
  RepositoryEntry,
  RepositorySetupFormValues,
  SavedRepositoryRow,
} from "../../types/repository-setup.types";
import {
  assessmentNameFromRepositories,
  deriveRepositoryEntryAnswer,
  repositoryDisplayName,
  repositoryFullNameOf,
  repositoryIdentityOf,
} from "../../utils/repository-entry";
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
import { RepositorySetupList } from "./repository-setup-list";

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
 * Business purpose: Guide an authorized customer through provider selection, credential setup and direct onboarding of one or several repositories (up to the assessment's repository limit) that are assessed together as one set.
 * Business rules: GitHub/GitLab preserve current behavior; Bitbucket/Azure require backend readiness and an active owner credential, and reconnection is an explicit action. Repositories are collected, validated and de-duplicated in the browser, saved candidates can still be removed or extended until setup completes, and the pinned set can no longer change.
 * Execution flow: 1. Load safe provider readiness and persisted setup. 2. Validate each provider-matched URL, reject duplicates and over-limit choices, and collect the repositories. 3. Connect/reconnect every chosen repository and prepare the whole pinned set through existing mutations.
 * Failure cases: Unavailable providers, invalid credentials, URL mismatches, duplicates, the repository limit and setup errors stop submission while preserving the existing assessment checkpoint.
 * Side effects: May configure a credential, connect repositories, remove a candidate, start preparation, update query caches and navigate after the backend activates the assessment.
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
  const removeRepository = useRemoveAssessmentRepositoryMutation(
    workingAssessmentId ?? "",
  );
  // The server reports how many repositories this assessment may hold; before the assessment exists the
  // contract maximum applies and the API remains the authority.
  const repositoryLimit =
    setupState?.repositoryLimit ?? ASSESSMENT_REPOSITORY_LIMITS.maxRepositories;
  const setupCompleted = setupState?.setupCompleted === true;
  const savedRows: SavedRepositoryRow[] = setupState
    ? repositorySetupEntries(setupState).map((entry) => ({
        snapshotId: entry.snapshot?.id ?? null,
        provider: entry.connection.provider,
        repositoryFullName: entry.connection.repositoryFullName,
        canonicalRepositoryUrl: entry.connection.canonicalRepositoryUrl ?? null,
        sourcePathPrefix: entry.snapshot?.sourcePathPrefix ?? null,
        commitSha: entry.snapshot?.commitSha ?? null,
        pinned: setupCompleted,
      }))
    : [];
  const [submitErrorKey, setSubmitErrorKey] = useState<string>();
  const [waitingForRules, setWaitingForRules] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // True while the customer extends an already saved set instead of looking at its status.
  const [addingMore, setAddingMore] = useState(false);
  const [wizardStep, setWizardStep] = useState<WizardStep>(
    WIZARD_STEPS.provider,
  );
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

  const form = useForm<RepositorySetupFormValues>({
    resolver: zodResolver(repositorySetupSchema),
    defaultValues: { provider: undefined, repositoryUrl: "", repositories: [] },
  });
  const provider = useWatch({ control: form.control, name: "provider" }) as
    GitProviderValue | undefined;
  const repositoryUrl =
    useWatch({ control: form.control, name: "repositoryUrl" }) ?? "";
  const pendingRepositories =
    useWatch({ control: form.control, name: "repositories" }) ?? [];
  const chosenCount = savedRows.length + pendingRepositories.length;
  const limitReached = chosenCount >= repositoryLimit;
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
  const draftIssue =
    form.formState.errors.repositoryUrl?.message ??
    form.formState.errors.provider?.message;
  const validationErrorKey = draftIssue
    ? (REPOSITORY_SETUP_ISSUE_MESSAGE_KEYS[
        draftIssue as keyof typeof REPOSITORY_SETUP_ISSUE_MESSAGE_KEYS
      ] ?? "pages.assessmentFlow.errors.repositoryUrl")
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
   * Business purpose: Validate one repository the customer typed and add it to the list of repositories to assess,
   * so several repositories can be chosen for a single assessment before analysis starts.
   * Business rules:
   * - The entry must match the chosen provider, must not repeat a repository (with the same source scope) already
   *   saved or pending, and must fit within the assessment's repository limit.
   * - A rejected entry is never added and never persisted; the customer keeps their other choices.
   * Execution flow:
   * 1. Validate provider and URL with the shared entry schema.
   * 2. Reject duplicates and limit overflow, otherwise append the entry and clear the URL draft.
   * Failure cases:
   * - Invalid, duplicate or over-limit entries set a field error and return null.
   * Side effects:
   * - Updates the form state only; nothing is sent to the API.
   */
  function addDraftRepository(): RepositoryEntry[] | null {
    const parsed = repositoryEntrySchema.safeParse({
      provider: form.getValues("provider"),
      repositoryUrl: form.getValues("repositoryUrl"),
      sourcePathPrefix: null,
    });
    if (!parsed.success) {
      form.setError("repositoryUrl", {
        type: "validate",
        message:
          parsed.error.issues[0]?.message ??
          REPOSITORY_SETUP_ISSUES.repositoryUrlInvalid,
      });
      return null;
    }
    const entry: RepositoryEntry = parsed.data;
    const identity = repositoryIdentityOf({
      provider: entry.provider,
      repositoryFullName: repositoryFullNameOf(entry),
      sourcePathPrefix: entry.sourcePathPrefix,
    });
    const pending = form.getValues("repositories");
    const knownIdentities = [
      ...savedRows.map((row) =>
        repositoryIdentityOf({
          provider: row.provider,
          repositoryFullName: row.repositoryFullName,
          sourcePathPrefix: row.sourcePathPrefix,
        }),
      ),
      ...pending.map((item) =>
        repositoryIdentityOf({
          provider: item.provider,
          repositoryFullName: repositoryFullNameOf(item),
          sourcePathPrefix: item.sourcePathPrefix,
        }),
      ),
    ];
    if (identity && knownIdentities.includes(identity)) {
      form.setError("repositoryUrl", {
        type: "validate",
        message: REPOSITORY_SETUP_ISSUES.duplicateRepository,
      });
      return null;
    }
    if (savedRows.length + pending.length >= repositoryLimit) {
      form.setError("repositoryUrl", {
        type: "validate",
        message: REPOSITORY_SETUP_ISSUES.limitReached,
      });
      return null;
    }
    const next = [...pending, entry];
    form.setValue("repositories", next, { shouldDirty: true });
    form.setValue("repositoryUrl", "");
    form.clearErrors();
    setSubmitErrorKey(undefined);
    return next;
  }

  /**
   * Business purpose: Save the customer's chosen repositories and advance only when the assessment is activated.
   * Business rules:
   * - Reuse persisted assessments, connections and snapshots on retries; never delete a saved checkpoint.
   * - Every chosen repository (saved earlier or typed now) is connected once and analysed together as one set.
   * - Reauthorize saved connections only after the customer selects the explicit reconnection action.
   * - A successful completion that remains PREPARING waits for approved compliance rules and must not navigate as if active.
   * Execution flow:
   * 1. Create an assessment only when needed, optionally reauthorize saved connections, then connect each newly typed repository.
   * 2. Pin and complete the whole repository set and show the legal-input prerequisite or navigate after activation.
   * 3. Refresh both setup and assessment detail so a same-route retry can leave the PREPARING view.
   * Failure cases:
   * - Connection, validation and preparation errors preserve saved inputs and show the mapped error for retry.
   * Side effects:
   * - May create assessment/repository records through the API, update query caches and navigate to an activated assessment.
   */
  async function runSetup(
    newEntries: readonly RepositoryEntry[] = [],
    forceReauthorization = false,
  ) {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setSubmitErrorKey(undefined);
    setWaitingForRules(false);
    setAddingMore(false);
    let assessmentId = workingAssessmentId;
    try {
      if (!assessmentId) {
        if (newEntries.length === 0) return;
        const outcome = await createAssessment.mutateAsync({
          name: assessmentNameFromRepositories(
            newEntries.map((entry) =>
              repositoryDisplayName(
                repositoryFullNameOf(entry) ?? entry.repositoryUrl,
              ),
            ),
            formatMoreRepositories,
          ),
        });
        if (outcome.kind !== API_OUTCOME_KINDS.created) {
          setSubmitErrorKey("pages.assessmentFlow.errors.createAssessment");
          return;
        }
        assessmentId = outcome.assessmentId;
        setWorkingAssessmentId(assessmentId);
      }
      const persisted = await getRepositorySetupState(assessmentId);
      const inputs: StartRepositoryAnalysisInput[] = [];
      for (const entry of repositorySetupEntries(persisted)) {
        let connection = entry.connection;
        if (forceReauthorization) {
          const answer = deriveRepositoryEntryAnswer({
            provider: connection.provider,
            repositoryFullName: connection.repositoryFullName,
            canonicalRepositoryUrl: connection.canonicalRepositoryUrl,
          });
          if (!answer) {
            setSubmitErrorKey("pages.assessmentFlow.errors.repositorySetup");
            return;
          }
          connection = await connectAssessmentRepository(
            assessmentId,
            answer.repositoryUrl,
            true,
          );
        }
        inputs.push({
          connectionId: connection.connectionId,
          branch: connection.defaultBranch,
          sourcePathPrefix: entry.snapshot?.sourcePathPrefix ?? null,
        });
      }
      for (const entry of newEntries) {
        const connection = await connectAssessmentRepository(
          assessmentId,
          entry.repositoryUrl,
        );
        inputs.push({
          connectionId: connection.connectionId,
          branch: connection.defaultBranch,
          sourcePathPrefix: entry.sourcePathPrefix,
        });
        // The repository is now saved on the server; it must not also stay in the pending list.
        form.setValue(
          "repositories",
          form
            .getValues("repositories")
            .filter((item) => item.repositoryUrl !== entry.repositoryUrl),
        );
      }
      if (inputs.length === 0) {
        setSubmitErrorKey("pages.assessmentFlow.errors.repositorySetup");
        return;
      }
      const result = await startRepositoryAnalysis(assessmentId, inputs);
      if (result.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.PREPARING) {
        setWaitingForRules(true);
        return;
      }
      router.replace(`/assessments/${assessmentId}`);
    } catch (error) {
      // A missing response does not prove rollback. Keep the Assessment and
      // reconcile its persisted checkpoint before any subsequent write.
      setSubmitErrorKey(resolveRepositorySetupErrorKey(error));
      // Repositories that could not be saved stay visible and editable instead of hiding behind the status view.
      if (form.getValues("repositories").length > 0) {
        setAddingMore(true);
        setWizardStep(WIZARD_STEPS.repository);
      }
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

  /**
   * Business purpose: Turn the repository form submit into "add this repository", and keep the one-step flow when the
   * assessment can only hold one repository.
   * Business rules:
   * - Every submit validates and adds the typed repository; analysis starts at once only when the limit is one.
   * Execution flow:
   * 1. Add the draft. 2. Start the analysis immediately for a one-repository assessment.
   * Failure cases:
   * - An invalid draft is reported on the field and nothing starts.
   * Side effects:
   * - Updates the form; may start the setup run.
   */
  function handleRepositorySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const entries = addDraftRepository();
    if (entries && repositoryLimit === 1) void runSetup(entries);
  }

  /**
   * Business purpose: Let the customer drop a saved repository that is still only a candidate.
   * Business rules:
   * - Only candidates can be removed; the server rejects removal once the set is pinned.
   * Execution flow:
   * 1. Call the removal mutation. 2. Report a failure and keep the list unchanged.
   * Failure cases:
   * - A rejected removal shows the remove-repository error; saved state is untouched.
   * Side effects:
   * - Deletes one candidate snapshot through the API and refreshes the setup query.
   */
  async function handleRemoveSaved(snapshotId: string) {
    setSubmitErrorKey(undefined);
    try {
      await removeRepository.mutateAsync(snapshotId);
    } catch {
      setSubmitErrorKey("pages.assessmentFlow.errors.removeRepository");
    }
  }

  /**
   * Business purpose: Let the customer extend a saved repository set before it is pinned.
   * Business rules:
   * - Offered only while the set is not pinned and the repository limit is not reached.
   * Execution flow:
   * 1. Leave the status view. 2. Restart the wizard at provider selection with an empty draft.
   * Failure cases:
   * - None; the add itself is validated by the repository form.
   * Side effects:
   * - Updates local wizard and form state only.
   */
  function handleAddAnother() {
    setAddingMore(true);
    setSubmitErrorKey(undefined);
    form.setValue("provider", undefined);
    form.setValue("repositoryUrl", "");
    form.clearErrors();
    setWizardStep(WIZARD_STEPS.provider);
  }

  const providerAvailability = Object.fromEntries(
    (credentialStatuses.data ?? []).map((status) => [
      status.provider,
      (status.enabled ??
        (status.provider === CREDENTIAL_PROVIDERS.github ||
          status.provider === CREDENTIAL_PROVIDERS.gitlab)) &&
        status.available !== false,
    ]),
  );

  const savedProvider = savedRows[0]?.provider as
    AssessmentRepositoryProvider | undefined;
  const draftProvider = provider
    ? (provider as AssessmentRepositoryProvider)
    : undefined;
  // While extending the set the provider chosen for the next repository leads; otherwise the saved one does.
  const selectedProvider =
    (addingMore ? draftProvider : (savedProvider ?? draftProvider)) ?? null;

  const selectedProviderEnabled = selectedProvider
    ? (providerAvailability[toCredentialProvider(selectedProvider) ?? ""] ??
      providerEnabled)
    : false;

  const isStatusView =
    (savedRows.length > 0 && !addingMore) || waitingForRules || isSubmitting;
  const canAddAnother =
    !setupCompleted && !limitReached && !isSubmitting && !waitingForRules;
  const chosenNames = [
    ...savedRows.map((row) => row.repositoryFullName),
    ...pendingRepositories.map(
      (entry) => repositoryFullNameOf(entry) ?? entry.repositoryUrl,
    ),
  ];
  const draftName = repositoryFullNameOf({
    provider: provider ?? "",
    repositoryUrl: repositoryUrl.trim(),
  });
  const chosenSummary = assessmentNameFromRepositories(
    chosenNames.map(repositoryDisplayName),
    formatMoreRepositories,
  );
  const savedProviderLabels = [
    ...new Set(
      savedRows.map((row) =>
        resolveGitProviderLabel(row.provider as AssessmentRepositoryProvider),
      ),
    ),
  ];
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
          context: savedProviderLabels.length
            ? savedProviderLabels.join(", ")
            : selectedProvider
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
            chosenNames.length > 1
              ? t("pages.assessmentFlow.repositoriesTitle")
                  .replace("{count}", String(chosenNames.length))
                  .replace("{limit}", String(repositoryLimit))
              : (chosenNames[0] ??
                (repositoryUrl.trim() ||
                  t("pages.assessmentFlow.summary.repositoryUnselected"))),
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
    chosenSummary ||
    (draftName ? repositoryDisplayName(draftName) : "") ||
    t("pages.assessmentFlow.setupPageTitle");

  return (
    <FormProvider {...form}>
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
          repositoryLabel={chosenSummary || repositoryUrl.trim() || null}
          rulesLabel={
            waitingForRules
              ? t("pages.assessmentFlow.summary.rulesBlocked")
              : t("pages.assessmentFlow.summary.rulesPending")
          }
        >
          <div className="space-y-4">
            {activeErrorKey && !isStatusView ? (
              <Alert variant="destructive">
                <AlertTitle>
                  {t("pages.assessmentFlow.errors.title")}
                </AlertTitle>
                <AlertDescription>{t(activeErrorKey)}</AlertDescription>
              </Alert>
            ) : null}

            {isStatusView ? (
              <div className="space-y-4">
                <SetupStatusPanel
                  rows={statusRows}
                  noticeTitle={
                    hasSetupError
                      ? t(
                          "pages.assessmentFlow.statusRows.retrySafeNoticeTitle",
                        )
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

                <RepositorySetupList
                  saved={savedRows}
                  limit={repositoryLimit}
                  disabled={isSubmitting || setupCompleted}
                  removingSnapshotId={
                    removeRepository.isPending
                      ? removeRepository.variables
                      : null
                  }
                  onRemoveSaved={(snapshotId) =>
                    void handleRemoveSaved(snapshotId)
                  }
                />

                <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
                  {savedRows.length > 0 ? (
                    <Button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() =>
                        void runSetup(pendingRepositories as RepositoryEntry[])
                      }
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
                  {savedRows.length > 0 && !setupCompleted ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isSubmitting}
                      onClick={() => void runSetup([], true)}
                    >
                      {t("pages.assessmentFlow.reauthorizeRepository")}
                    </Button>
                  ) : null}
                  {canAddAnother ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleAddAnother}
                    >
                      {t("pages.assessmentFlow.addRepository")}
                    </Button>
                  ) : null}
                  {workingAssessmentId &&
                  !setupState &&
                  !setupQuery.isFetching ? (
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
                  setCredentialDialogMode(
                    PROVIDER_CREDENTIAL_DIALOG_MODES.connect,
                  );
                  setCredentialDialogOpen(true);
                }}
                onContinue={() => setWizardStep(WIZARD_STEPS.repository)}
                onBack={() => setWizardStep(WIZARD_STEPS.provider)}
              />
            ) : wizardStep === WIZARD_STEPS.repository && selectedProvider ? (
              <form className="space-y-4" onSubmit={handleRepositorySubmit}>
                <RepositorySetupList
                  saved={savedRows}
                  limit={repositoryLimit}
                  disabled={isSubmitting || setupCompleted}
                  removingSnapshotId={
                    removeRepository.isPending
                      ? removeRepository.variables
                      : null
                  }
                  onRemoveSaved={(snapshotId) =>
                    void handleRemoveSaved(snapshotId)
                  }
                />
                {chosenCount > 0 && repositoryLimit > 1 ? (
                  <p className="text-xs text-muted-foreground">
                    {t(
                      limitReached
                        ? "pages.assessmentFlow.repositoryLimitReached"
                        : "pages.assessmentFlow.addRepositoryHint",
                    ).replace("{limit}", String(repositoryLimit))}
                  </p>
                ) : null}
                <RepositoryPicker
                  control={form.control}
                  provider={selectedProvider}
                  connected={credentialConfigured}
                  previewOnly={!selectedProviderEnabled}
                  canEnterRepository={
                    canEnterRepository &&
                    !limitReached &&
                    !(Boolean(workingAssessmentId) && !setupState)
                  }
                  isSubmitting={isSubmitting}
                  pinnedCommitSha={null}
                  errorMessage={
                    validationErrorKey ? t(validationErrorKey) : undefined
                  }
                  submitLabel={
                    repositoryLimit > 1
                      ? t("pages.assessmentFlow.source.addAction")
                      : undefined
                  }
                  actions={
                    chosenCount > 0 ? (
                      <Button
                        type="button"
                        disabled={isSubmitting || setupCompleted}
                        onClick={() =>
                          void runSetup(
                            form.getValues("repositories") as RepositoryEntry[],
                          )
                        }
                      >
                        {t(
                          isSubmitting
                            ? "pages.assessmentFlow.startingAnalysis"
                            : pendingRepositories.length === 0
                              ? "pages.assessmentFlow.resumeSetup"
                              : "pages.assessmentFlow.startAnalysis",
                        )}
                      </Button>
                    ) : null
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
                          form.setValue("provider", nextProvider);
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
                  {workingAssessmentId &&
                  !setupState &&
                  !setupQuery.isFetching ? (
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
              onSetupRequest: () =>
                router.push(API_REDIRECT_LOCATIONS.mfaEnroll),
              errorTitleKey: confirmAccessMfaError?.titleKey,
              errorKey: confirmAccessMfaError?.detailKey ?? null,
            }}
          />
        ) : null}
      </main>
    </FormProvider>
  );
}

/**
 * Business purpose: Map repository onboarding failures to localized corrective guidance.
 * Business rules: Provider problem categories take precedence over opaque exception messages; repository-set limit, duplicate and immutability codes get their own guidance; unknown errors retain the generic setup failure message.
 * Execution flow: 1. Map typed provider problems through the shared credential mapper. 2. Map repository-set and legacy setup codes. 3. Use the generic retry message.
 * Failure cases: Unrecognized details are not exposed to the customer.
 * Side effects: Pure error projection without logging provider response data.
 */
function resolveRepositorySetupErrorKey(error: unknown): string {
  if (error instanceof GitHubRepositoryRequestError) {
    return githubRepositoryProblemMessageKey(error);
  }
  if (error instanceof Error) {
    const code = error.message;
    if (code === REPOSITORY_SET_ERROR_CODES.limitExceeded) {
      return "pages.assessmentFlow.errors.repositoryLimit";
    }
    if (code === REPOSITORY_SET_ERROR_CODES.duplicate) {
      return "pages.assessmentFlow.errors.duplicateRepository";
    }
    if (code === REPOSITORY_SET_ERROR_CODES.immutable) {
      return "pages.assessmentFlow.errors.repositorySetImmutable";
    }
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
 * Business purpose: Summarise several repositories as one readable label (first name plus a localised "+N").
 * Business rules: The first repository names the group; the suffix counts the others.
 * Execution flow: 1. Fill the localised template with the first name and the remaining count.
 * Failure cases: None; the template always resolves.
 * Side effects: Pure display formatting.
 */
function formatMoreRepositories(name: string, count: number) {
  return t("pages.assessmentFlow.multiRepositoryName")
    .replace("{name}", name)
    .replace("{count}", String(count));
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
