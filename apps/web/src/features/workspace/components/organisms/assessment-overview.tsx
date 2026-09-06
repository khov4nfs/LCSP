"use client";

import {
  ASSESSMENT_FLOW_STAGES,
  ASSESSMENT_REPOSITORY_PROVIDERS,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS,
  ASSESSMENT_INTERVIEW_CONTROLS,
  type AssessmentInterviewBlockedAction,
} from "@lcsp/contracts/evidence";
import { REPOSITORY_CONNECTION_STATUSES } from "@lcsp/contracts/github-integration";
import { resolveMessage } from "@lcsp/i18n";
import { SaveIcon, TextCursorInputIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { RepositorySetupStep } from "@/features/assessment-flow/components/organisms/repository-setup-step";
import { ScannerStep } from "@/features/assessment-flow/components/organisms/scanner-step";
import { deriveAssessmentFlowRuntime } from "@/features/assessment-flow/utils/assessment-flow-runtime";
import {
  useAssessmentInterviewBlockedActionMutation,
  useAssessmentInterviewStateQuery,
  useReadinessStatusQuery,
  useSubmitAssessmentInterviewAnswerMutation,
} from "@/lib/api/assessment-queries";
import { API_OUTCOME_KINDS } from "@/lib/api/outcome-kinds";
import { appLocale } from "@/lib/locale";

import { useAssessmentRuntimeViewModel } from "../../hooks/use-assessment-runtime-view-model";
import type { AssessmentOverviewProps } from "../../types/assessment-overview.types";
import { ASSESSMENT_CHAT_ROLES } from "../../types/assessment-chat.types";
import {
  selectComposerAvailability,
  selectCustomerActions,
  selectInterviewHandoffPresentation,
  selectInterviewPresentation,
  selectWorkflowPresentation,
} from "../../utils/assessment-runtime-selectors";
import {
  AgentMessage,
  AgentTurn,
  ThinkingLine,
  ThoughtLine,
  UserMessage,
} from "../molecules/agent-turn";
import {
  AssessmentQuestionTurn,
  type AssessmentQuestionAnswerInput,
} from "../molecules/assessment-question-turn";
import { AssessmentComposer } from "./assessment-composer";
import { AssessmentTranscript } from "./assessment-transcript";
import { useWorkspaceRuntime } from "./workspace-runtime-provider";

type InterviewAnswerDraft = {
  questionId: string;
  freeText: string;
  selectedChoiceIds: string[];
  otherText: string;
  isAdjusting?: boolean;
};

export function AssessmentOverview({ assessmentId }: AssessmentOverviewProps) {
  const workspaceRuntime = useWorkspaceRuntime();
  const readinessQuery = useReadinessStatusQuery(assessmentId);
  const connection =
    readinessQuery.data?.kind === API_OUTCOME_KINDS.loaded
      ? readinessQuery.data.data.repositoryConnection
      : null;
  const readinessLoaded =
    readinessQuery.data?.kind === API_OUTCOME_KINDS.loaded;
  const snapshot =
    workspaceRuntime.repositorySnapshots.find(
      (item) => item.assessmentId === assessmentId,
    ) ?? null;
  const scanJob =
    workspaceRuntime.scanJobs.find(
      (item) => item.assessmentId === assessmentId,
    ) ?? null;
  const evidenceReport =
    workspaceRuntime.evidenceReports.find(
      (item) => item.assessmentId === assessmentId,
    ) ?? null;
  const timeline = workspaceRuntime.getAssessmentRuntime(assessmentId);
  const flow = deriveAssessmentFlowRuntime({
    hasRepositoryConnection: readinessLoaded
      ? connection?.status === REPOSITORY_CONNECTION_STATUSES.active
      : Boolean(snapshot),
    snapshot,
    scanJob,
    evidenceReport,
    recentActivity: timeline.recentActivity,
  });

  if (readinessQuery.isLoading && !snapshot) {
    return (
      <main className="flex h-full min-h-0 flex-col">
        <AssessmentTranscript>
          <AgentTurn>
            <ThinkingLine
              label={t("pages.assessmentFlow.repository.loadingState")}
            />
          </AgentTurn>
        </AssessmentTranscript>
        <AssessmentComposer
          value=""
          onValueChange={() => undefined}
          onSubmit={() => undefined}
          disabled
          placeholder={t("pages.assessmentFlow.repository.loadingState")}
        />
      </main>
    );
  }

  if (flow.stage === ASSESSMENT_FLOW_STAGES.repositorySetup) {
    return <RepositorySetupStep assessmentId={assessmentId} />;
  }

  return (
    <AssessmentInterviewFlow
      assessmentId={assessmentId}
      interviewEnabled={flow.stage === ASSESSMENT_FLOW_STAGES.interview}
      scanner={
        <ScannerStep
          repository={{
            provider:
              connection?.provider ??
              snapshot?.provider ??
              ASSESSMENT_REPOSITORY_PROVIDERS.github,
            repositoryFullName:
              connection?.repositoryFullName ??
              snapshot?.repositoryFullName ??
              t("pages.assessmentFlow.repository.pending"),
            commitSha:
              snapshot?.commitSha ??
              t("pages.assessmentFlow.repository.pending"),
          }}
          activities={flow.activities}
          evidenceReady={flow.evidenceAccepted}
          programEvidenceSummary={flow.programEvidenceSummary}
        />
      }
      scanFailed={flow.scanFailed}
      runtimeKey={[
        snapshot?.id,
        scanJob?.id,
        scanJob?.status,
        evidenceReport?.id,
        evidenceReport?.status,
      ].join(":")}
    />
  );
}

function AssessmentInterviewFlow({
  assessmentId,
  interviewEnabled,
  scanner,
  scanFailed,
  runtimeKey,
}: {
  assessmentId: string;
  interviewEnabled: boolean;
  scanner: ReactNode;
  scanFailed: boolean;
  runtimeKey: string;
}) {
  // Query hook reference preserved for reactivity & test compatibility.
  const interviewQuery = useAssessmentInterviewStateQuery(
    assessmentId,
    interviewEnabled,
  );
  const normalized = useAssessmentRuntimeViewModel(
    assessmentId,
    interviewEnabled,
  );
  const interview = selectInterviewPresentation(normalized);
  const workflow = selectWorkflowPresentation(normalized);
  const customerActions = selectCustomerActions(normalized);
  const composerAvailability = selectComposerAvailability(normalized);
  const interviewHandoff = selectInterviewHandoffPresentation(normalized);
  const submitAnswer = useSubmitAssessmentInterviewAnswerMutation(assessmentId);
  const recordBlockedAction =
    useAssessmentInterviewBlockedActionMutation(assessmentId);

  const activeQuestion = interview.activeQuestion;
  const activeQuestionId = activeQuestion?.id ?? "";

  const [draftMap, setDraftMap] = useState<Record<string, InterviewAnswerDraft>>({});
  const [lastSavedMessage, setLastSavedMessage] = useState<string | null>(null);

  const activeDraft: InterviewAnswerDraft =
    draftMap[assessmentId] && draftMap[assessmentId].questionId === activeQuestionId
      ? draftMap[assessmentId]
      : {
          questionId: activeQuestionId,
          freeText: interview.pendingDraft ?? "",
          selectedChoiceIds: [],
          otherText: "",
          isAdjusting: false,
        };

  const selectedChoiceRequiresFreeText = Boolean(
    activeQuestion?.choices?.some(
      (choice) =>
        choice.requiresFreeText &&
        activeDraft.selectedChoiceIds.includes(choice.id),
    ),
  );

  const composerValue = selectedChoiceRequiresFreeText
    ? activeDraft.otherText
    : activeDraft.freeText;

  let isSubmitReady = false;
  if (
    interviewEnabled &&
    customerActions.canAnswerQuestion &&
    activeQuestion &&
    !interview.stale &&
    !interview.revalidating
  ) {
    if (activeQuestion.control === ASSESSMENT_INTERVIEW_CONTROLS.freeText) {
      isSubmitReady = activeDraft.freeText.trim().length > 0;
    } else if (
      activeQuestion.control === ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust
    ) {
      isSubmitReady =
        activeDraft.isAdjusting === true && activeDraft.freeText.trim().length > 0;
    } else if (
      activeQuestion.control === ASSESSMENT_INTERVIEW_CONTROLS.singleSelect ||
      activeQuestion.control === ASSESSMENT_INTERVIEW_CONTROLS.boolean
    ) {
      if (activeDraft.selectedChoiceIds.length === 1) {
        isSubmitReady = selectedChoiceRequiresFreeText
          ? activeDraft.otherText.trim().length > 0
          : true;
      }
    } else if (
      activeQuestion.control === ASSESSMENT_INTERVIEW_CONTROLS.multiSelect
    ) {
      if (activeDraft.selectedChoiceIds.length > 0) {
        isSubmitReady = selectedChoiceRequiresFreeText
          ? activeDraft.otherText.trim().length > 0
          : true;
      }
    }
  }

  let composerPlaceholderKey = composerAvailability.placeholderKey;
  if (scanFailed) {
    composerPlaceholderKey = "pages.assessmentFlow.scanner.failedPlaceholder";
  } else if (!interviewEnabled) {
    composerPlaceholderKey = "pages.assessmentFlow.scanner.runningPlaceholder";
  } else if (customerActions.canAnswerQuestion && activeQuestion) {
    if (
      activeQuestion.control === ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust
    ) {
      composerPlaceholderKey = activeDraft.isAdjusting
        ? "pages.assessment.adjustPlaceholder"
        : "pages.assessment.composerChooseConfirmAdjust";
    } else if (selectedChoiceRequiresFreeText) {
      composerPlaceholderKey = "pages.assessment.otherDescribe";
    } else if (
      activeQuestion.control === ASSESSMENT_INTERVIEW_CONTROLS.singleSelect ||
      activeQuestion.control === ASSESSMENT_INTERVIEW_CONTROLS.multiSelect ||
      activeQuestion.control === ASSESSMENT_INTERVIEW_CONTROLS.boolean
    ) {
      composerPlaceholderKey = "pages.assessment.composerChooseOption";
    } else if (composerAvailability.isEnabled) {
      composerPlaceholderKey = "pages.assessmentFlow.interview.placeholder";
    } else {
      composerPlaceholderKey = interviewHandoff.placeholderKey;
    }
  } else if (composerAvailability.isEnabled) {
    composerPlaceholderKey = "pages.assessmentFlow.interview.placeholder";
  } else {
    composerPlaceholderKey = interviewHandoff.placeholderKey;
  }

  const answerHistory = interview.answerHistory;
  const autoScrollKey = [
    assessmentId,
    runtimeKey,
    workflow.currentRunId,
    workflow.status,
    normalized.workflow.latestRun?.updatedAt ?? workflow.lastEmittedAt,
    interviewQuery.dataUpdatedAt,
    activeQuestionId,
    answerHistory.length,
    lastSavedMessage,
  ].join("::");

  function handleSelectedChoicesChange(selectedChoiceIds: string[]) {
    setDraftMap((current) => ({
      ...current,
      [assessmentId]: {
        ...activeDraft,
        selectedChoiceIds,
      },
    }));
  }

  function handleAdjust() {
    setDraftMap((current) => ({
      ...current,
      [assessmentId]: {
        ...activeDraft,
        isAdjusting: true,
      },
    }));
  }

  function handleComposerValueChange(value: string) {
    if (selectedChoiceRequiresFreeText) {
      setDraftMap((current) => ({
        ...current,
        [assessmentId]: {
          ...activeDraft,
          otherText: value,
        },
      }));
    } else {
      setDraftMap((current) => ({
        ...current,
        [assessmentId]: {
          ...activeDraft,
          freeText: value,
        },
      }));
    }
  }

  function clearDraft() {
    setDraftMap((current) => {
      const next = { ...current };
      delete next[assessmentId];
      return next;
    });
  }

  function handleSubmit() {
    if (!isSubmitReady || !activeQuestion || !interviewEnabled) {
      return;
    }
    const input: AssessmentQuestionAnswerInput = {
      questionId: activeQuestion.id,
    };
    if (activeQuestion.control === ASSESSMENT_INTERVIEW_CONTROLS.freeText) {
      input.freeText = activeDraft.freeText.trim();
    } else if (
      activeQuestion.control === ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust
    ) {
      input.adjusted = true;
      input.freeText = activeDraft.freeText.trim();
    } else if (
      activeQuestion.control === ASSESSMENT_INTERVIEW_CONTROLS.singleSelect ||
      activeQuestion.control === ASSESSMENT_INTERVIEW_CONTROLS.boolean ||
      activeQuestion.control === ASSESSMENT_INTERVIEW_CONTROLS.multiSelect
    ) {
      input.selectedChoiceIds = activeDraft.selectedChoiceIds;
      if (selectedChoiceRequiresFreeText) {
        input.otherText = activeDraft.otherText.trim();
      }
    }
    handleQuestionAnswer(input);
  }

  function handleQuestionAnswer(input: AssessmentQuestionAnswerInput) {
    if (
      !interviewEnabled ||
      !customerActions.canAnswerQuestion ||
      interview.stale ||
      interview.revalidating
    ) {
      return;
    }
    submitAnswer.mutate(input, {
      onSuccess: () => {
        clearDraft();
        setLastSavedMessage(t("pages.assessment.answerSavedForRuntime"));
      },
    });
  }

  function handleBlockedAction(action: AssessmentInterviewBlockedAction) {
    if (!interviewEnabled || !customerActions.canSubmitBlockedAction) {
      return;
    }
    recordBlockedAction.mutate(
      {
        action,
        draft:
          action === ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.saveAndExit
            ? composerValue.trim() || undefined
            : undefined,
      },
      {
        onSuccess: () => {
          if (action === ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.saveAndExit) {
            clearDraft();
            setLastSavedMessage(t("pages.assessment.draftSavedForResume"));
            return;
          }
          setLastSavedMessage(t("pages.assessment.blockedActionRecorded"));
        },
      },
    );
  }

  const isComposerDisabled =
    !interviewEnabled ||
    scanFailed ||
    !composerAvailability.isEnabled ||
    interview.stale ||
    interview.revalidating ||
    (activeQuestion?.control === ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust &&
      !activeDraft.isAdjusting);

  return (
    <main
      className="flex h-full min-h-0 flex-col"
      data-assessment-id={assessmentId}
      data-surface="workflow-run"
      data-flow-stage={
        interviewEnabled
          ? ASSESSMENT_FLOW_STAGES.interview
          : ASSESSMENT_FLOW_STAGES.scanner
      }
    >
      <AssessmentTranscript autoScrollKey={autoScrollKey}>
        {scanner}

        {interviewEnabled ? (
          <>
            {answerHistory.map((answer) => (
              <AgentTurn
                key={`${answer.questionId}:${answer.answeredAt}`}
                role={ASSESSMENT_CHAT_ROLES.user}
              >
                <UserMessage>
                  {answer.summary}
                </UserMessage>
              </AgentTurn>
            ))}

            {interview.questionTurnProps ? (
              <AgentTurn
                content={
                  <AgentMessage>
                    <ThoughtLine
                      label={t("pages.assessmentFlow.interview.thought")}
                    />
                    <p className="mt-2">
                      {t("pages.assessmentFlow.interview.readyDescription")}
                    </p>
                  </AgentMessage>
                }
                terminalAction={
                  <AssessmentQuestionTurn
                    question={interview.questionTurnProps.question}
                    selectedChoiceIds={activeDraft.selectedChoiceIds}
                    onSelectedChoiceIdsChange={handleSelectedChoicesChange}
                    isAdjusting={activeDraft.isAdjusting}
                    onAdjust={handleAdjust}
                    blockedActions={interview.questionTurnProps.blockedActions}
                    disabled={
                      !customerActions.canAnswerQuestion ||
                      interview.stale ||
                      interview.revalidating ||
                      submitAnswer.isPending
                    }
                    onSubmitAnswer={handleQuestionAnswer}
                    onBlockedAction={handleBlockedAction}
                  />
                }
              />
            ) : interview.isBlocked &&
              customerActions.canSubmitBlockedAction &&
              customerActions.availableBlockedActions.length > 0 ? (
              <AgentTurn
                content={
                  <AgentMessage>
                    <ThoughtLine
                      label={t("pages.assessmentFlow.interview.thought")}
                    />
                    <p className="mt-2">
                      {t("pages.assessmentFlow.interview.readyDescription")}
                    </p>
                    <p className="mt-2 text-muted-foreground">
                      {t("pages.assessment.blockedActionRecorded")}
                    </p>
                  </AgentMessage>
                }
                terminalAction={
                  <div
                    data-slot="blocked-or-unresolved-actions"
                    className="flex flex-wrap gap-2"
                  >
                    {customerActions.availableBlockedActions.map((action) => (
                      <Button
                        key={action}
                        type="button"
                        size="sm"
                        variant={
                          action ===
                          ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.saveAndExit
                            ? "outline"
                            : "secondary"
                        }
                        onClick={() => handleBlockedAction(action)}
                      >
                        {action ===
                        ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.saveAndExit ? (
                          <SaveIcon />
                        ) : (
                          <TextCursorInputIcon />
                        )}
                        {blockedActionLabel(action)}
                      </Button>
                    ))}
                  </div>
                }
              />
            ) : interview.isFailed ? (
              <AgentTurn>
                <AgentMessage className="font-medium text-destructive">
                  {t("pages.appShell.chatActivityStatuses.failed")}
                </AgentMessage>
              </AgentTurn>
            ) : (
              <AgentTurn>
                <AgentMessage>
                  <ThoughtLine
                    label={t("pages.assessmentFlow.interview.thought")}
                  />
                  <p className="mt-2 text-muted-foreground">
                    {t(interviewHandoff.messageKey)}
                  </p>
                </AgentMessage>
              </AgentTurn>
            )}

            {lastSavedMessage ? (
              <AgentTurn>
                <AgentMessage className="text-muted-foreground">
                  {lastSavedMessage}
                </AgentMessage>
              </AgentTurn>
            ) : null}
          </>
        ) : null}
      </AssessmentTranscript>

      <AssessmentComposer
        value={composerValue}
        disabled={isComposerDisabled}
        submitReady={isSubmitReady}
        submitting={submitAnswer.isPending || recordBlockedAction.isPending}
        placeholder={t(composerPlaceholderKey)}
        onValueChange={handleComposerValueChange}
        onSubmit={handleSubmit}
      />
    </main>
  );
}

function blockedActionLabel(action: AssessmentInterviewBlockedAction) {
  if (action === ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.provideMoreContext) {
    return t("pages.assessment.blockedProvideMoreContext");
  }
  if (action === ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.checkInternally) {
    return t("pages.assessment.blockedCheckInternally");
  }
  return t("pages.assessment.blockedSaveExit");
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
