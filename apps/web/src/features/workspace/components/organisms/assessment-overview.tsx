"use client";

import {
  ASSESSMENT_FLOW_STAGES,
  ASSESSMENT_REPOSITORY_PROVIDERS,
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_AGENT_STREAM_STAGES,
  ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS,
  ASSESSMENT_INTERVIEW_CONTROLS,
  ASSESSMENT_RUNTIME_CONTROL_STATES,
  type AssessmentInterviewBlockedAction,
  type RemediationDecision,
} from "@lcsp/contracts/evidence";
import {
  REPOSITORY_CONNECTION_STATUSES,
  REPOSITORY_SCAN_JOB_STATUSES,
} from "@lcsp/contracts/github-integration";
import { resolveMessage } from "@lcsp/i18n";
import { InfoIcon, SaveIcon, TextCursorInputIcon } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { RepositorySetupConversation } from "@/features/assessment-flow/components/organisms/repository-setup-conversation";
import { RepositorySetupStep } from "@/features/assessment-flow/components/organisms/repository-setup-step";
import { ScannerStep } from "@/features/assessment-flow/components/organisms/scanner-step";
import { deriveAssessmentFlowRuntime } from "@/features/assessment-flow/utils/assessment-flow-runtime";
import { deriveRepositorySetupAnswer } from "@/features/assessment-flow/utils/repository-setup-history";
import {
  useAssessmentInterviewBlockedActionMutation,
  useAssessmentInterviewStateQuery,
  useContinueAssessmentPipelineMutation,
  useProgramEvidenceGraphOverviewQuery,
  useReadinessStatusQuery,
  useRerunRepositoryScanMutation,
  useSubmitAssessmentInterviewAnswerMutation,
  useSubmitAssessmentPostFindingDecisionMutation,
} from "@/lib/api/assessment-queries";
import { useAssessmentRuntimeControl } from "@/lib/api/assessment-runtime-control-queries";
import { API_OUTCOME_KINDS } from "@/lib/api/outcome-kinds";
import { isGraphOverviewReadyFor } from "@/lib/api/evidence-graph-overview-client";
import { appLocale } from "@/lib/locale";

import {
  PIPELINE_CONTINUE_FAILED_MESSAGE_KEY,
  pipelineContinueMessageKey,
} from "../../config/pipeline-continue";
import { useAssessmentRuntimeViewModel } from "../../hooks/use-assessment-runtime-view-model";
import type { AssessmentOverviewProps } from "../../types/assessment-overview.types";
import { WORKSPACE_RUNTIME_CONNECTION_STATES } from "../../types/workspace-runtime.types";
import {
  scopeAgentStreamRunEvents,
  shouldShowAgentStreamHistoryAction,
} from "../../utils/agent-stream-projection";
import {
  groupAgentStreamEventsByRun,
  groupAgentStreamEventsByStage,
  interleaveInterviewTranscript,
  splitCurrentInterviewActivity,
} from "../../utils/agent-stream-stages";
import { agentThinkingLabel } from "../../utils/agent-thinking-label";
import { selectAssessmentComposerRuntimeControl } from "../../utils/assessment-composer-control";
import {
  selectComposerAvailability,
  selectCustomerActions,
  selectInterviewHandoffPresentation,
  selectInterviewPresentation,
  selectPostFindingPresentation,
  selectRuntimeThinkingItems,
  selectWorkflowPresentation,
} from "../../utils/assessment-runtime-selectors";
import { AgentStreamDispatchTurns } from "../molecules/agent-stream-dispatch-turns";
import { InterviewMutationFeedback } from "../molecules/interview-mutation-feedback";
import {
  AGENT_STREAM_RUN_OUTCOMES,
  AgentStreamTimeline,
} from "../molecules/agent-stream-timeline";
import { AgentStreamTurn } from "../molecules/agent-stream-turn";
import {
  AgentMessage,
  AgentTurn,
  ThinkingLine,
  ThoughtLine,
} from "../molecules/agent-turn";
import {
  AssessmentQuestionTurn,
  type AssessmentQuestionAnswerInput,
} from "../molecules/assessment-question-turn";
import {
  InterviewCycleOutput,
  InterviewCycleTurn,
} from "../molecules/interview-cycle-turn";
import { InterviewOutputPanel } from "../molecules/interview-output-panel";
import { PostFindingFlowSteps } from "../molecules/post-finding-flow-steps";
import { TurnFooter } from "../molecules/turn-footer";
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
  const readinessLoaded =
    readinessQuery.data?.kind === API_OUTCOME_KINDS.loaded;
  const readiness =
    readinessQuery.data?.kind === API_OUTCOME_KINDS.loaded
      ? readinessQuery.data.data
      : undefined;
  const setupState = readiness?.repositorySetup;
  const connection = setupState
    ? setupState.connection
    : (readiness?.repositoryConnection ?? null);
  // Explicit null checkpoints must not resurrect a stale SSE snapshot.
  const snapshot = setupState
    ? setupState.snapshot
    : (workspaceRuntime.repositorySnapshots.find(
        (item) => item.assessmentId === assessmentId,
      ) ?? null);
  const liveScanJob =
    workspaceRuntime.scanJobs.find(
      (item) =>
        item.assessmentId === assessmentId && item.snapshotId === snapshot?.id,
    ) ?? null;
  const persistedScanJob = setupState?.scanJob ?? null;
  const scanJob = liveScanJob && (
    !persistedScanJob || liveScanJob.updatedAt >= persistedScanJob.updatedAt
  ) ? liveScanJob : persistedScanJob;

  const graphFilters = snapshot?.id
    ? { snapshotId: snapshot.id, scanJobId: scanJob?.id }
    : undefined;
  const evidenceOverviewQuery =
    useProgramEvidenceGraphOverviewQuery(assessmentId, graphFilters);
  const retryScan = useRerunRepositoryScanMutation(assessmentId);
  const retryKeyRef = useRef<string | null>(null);

  const evidenceReport =
    workspaceRuntime.evidenceReports.find(
      (item) =>
        item.assessmentId === assessmentId &&
        item.snapshotId === snapshot?.id &&
        item.scanJobId === scanJob?.id,
    ) ?? null;
  const timeline = workspaceRuntime.getAssessmentRuntime(assessmentId);
  const repositoryAnswer = deriveRepositorySetupAnswer(connection ?? snapshot);
  const flow = deriveAssessmentFlowRuntime({
    setupState,
    hasRepositoryConnection: readinessLoaded
      ? connection?.status === REPOSITORY_CONNECTION_STATUSES.active
      : Boolean(snapshot),
    snapshot,
    scanJob,
    evidenceReport,
    evidenceGraphReady: isGraphOverviewReadyFor(
      evidenceOverviewQuery.data,
      { snapshotId: snapshot?.id, scanJobId: scanJob?.id },
      evidenceReport?.id,
    ),
    recentActivity: timeline.recentActivity,
  });
  const retryScanSnapshotId = scanJob?.snapshotId ?? snapshot?.id;
  const retryScanDisabled =
    retryScanSnapshotId === undefined || retryScan.isPending;

  const handleRetryScan = () => {
    if (retryScanSnapshotId !== undefined && !retryScanDisabled) {
      if (!retryKeyRef.current) {
        retryKeyRef.current = crypto.randomUUID();
      }
      retryScan.mutate(
        {
          snapshotId: retryScanSnapshotId,
          idempotencyKey: retryKeyRef.current,
        },
        {
          onSuccess: () => {
            retryKeyRef.current = null;
          },
        },
      );
    }
  };

  if (readinessQuery.isLoading) {
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

  if (!readinessLoaded) {
    return (
      <main className="flex h-full flex-col items-start gap-4 p-4">
        <p role="alert">{t("pages.readiness.errorDetail")}</p>
        <Button
          disabled={readinessQuery.isFetching}
          onClick={() => void readinessQuery.refetch()}
        >
          {t("pages.assessmentFlow.retrySetupState")}
        </Button>
      </main>
    );
  }

  if (flow.stage === ASSESSMENT_FLOW_STAGES.repositorySetup) {
    return (
      <RepositorySetupStep key={assessmentId} assessmentId={assessmentId} />
    );
  }

  return (
    <AssessmentInterviewFlow
      assessmentId={assessmentId}
      interviewEnabled={flow.stage === ASSESSMENT_FLOW_STAGES.interview}
      scanner={
        <>
          {repositoryAnswer ? (
            <RepositorySetupConversation {...repositoryAnswer} disabled />
          ) : null}
          <ScannerStep
            assessmentId={assessmentId}
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
            graphReady={flow.evidenceGraphReady}
            thinkingLabel={agentThinkingLabel(
              flow.scanActive,
              scopeAgentStreamRunEvents(
                groupAgentStreamEventsByStage(timeline.agentStreamEvents ?? [])
                  .byStage[ASSESSMENT_AGENT_STREAM_STAGES.scanner],
                scanJob?.id ?? null,
              ),
            )}
            programEvidenceSummary={flow.programEvidenceSummary}
            canonicalOverview={evidenceOverviewQuery.data}
            scanFailed={flow.scanFailed}
            isQueued={scanJob?.status === REPOSITORY_SCAN_JOB_STATUSES.queued}
            isReconnecting={
              workspaceRuntime.connectionState ===
              WORKSPACE_RUNTIME_CONNECTION_STATES.disconnected
            }
            retryScanPending={retryScan.isPending}
            retryScanError={retryScan.isError}
            retryScanDisabled={retryScanDisabled}
            onRetryScan={handleRetryScan}
          />
        </>
      }
      scanFailed={flow.scanFailed}
      scannerActive={flow.scanActive}
      activeScanRunId={retryScan.data?.scanJobId ?? scanJob?.id ?? null}
      resetScannerActivity={retryScan.isPending}
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
  scannerActive,
  activeScanRunId,
  resetScannerActivity,
  runtimeKey,
}: {
  assessmentId: string;
  interviewEnabled: boolean;
  scanner: ReactNode;
  scanFailed: boolean;
  scannerActive: boolean;
  activeScanRunId: string | null;
  resetScannerActivity: boolean;
  runtimeKey: string;
}) {
  const workspaceRuntime = useWorkspaceRuntime();
  const liveTimeline = workspaceRuntime.getAssessmentRuntime(assessmentId);
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
  const postFinding = selectPostFindingPresentation(normalized);
  // Kept only as an autoScrollKey signal below: Rule-analysis activity
  // itself now renders exclusively through interviewTranscript (per-turn,
  // interleaved with its own Q&A), not as these aggregate summary rows.
  const runtimeThinkingItems = selectRuntimeThinkingItems(normalized);
  const stageEvents = useMemo(
    () => groupAgentStreamEventsByStage(liveTimeline.agentStreamEvents ?? []),
    [liveTimeline.agentStreamEvents],
  );
  const canonicalLifecycleState =
    liveTimeline.canonicalAssessment?.lifecycle?.state ?? null;
  const canonicalExecutionState =
    liveTimeline.canonicalAssessment?.runtime?.executionState ?? null;
  const boundaryPaused =
    canonicalLifecycleState === ASSESSMENT_LIFECYCLE_STATES.PAUSED ||
    canonicalExecutionState === AGENT_EXECUTION_STATES.INTERRUPTED ||
    canonicalExecutionState === AGENT_EXECUTION_STATES.PAUSED;
  // Which downstream stage is actively running right now, if any — drives a
  // composer placeholder that reflects what's really happening (planning,
  // investigating, reviewing) instead of always saying "waiting on Interview"
  // while rule analysis/Gate are the ones doing the work.
  const runningDownstreamStage = useMemo(() => {
    const priority = [
      ASSESSMENT_AGENT_STREAM_STAGES.gate,
      ASSESSMENT_AGENT_STREAM_STAGES.ruleAnalysis,
    ] as const;
    if (canonicalExecutionState !== AGENT_EXECUTION_STATES.RUNNING) {
      return null;
    }
    return (
      priority.find((stage) => stageEvents.byStage[stage].length > 0) ?? null
    );
  }, [canonicalExecutionState, stageEvents]);
  const downstreamPlaceholderKey =
    runningDownstreamStage === ASSESSMENT_AGENT_STREAM_STAGES.gate
      ? "pages.assessmentFlow.interview.gatePlaceholder"
      : runningDownstreamStage === ASSESSMENT_AGENT_STREAM_STAGES.ruleAnalysis
        ? "pages.assessmentFlow.interview.investigatePlaceholder"
        : null;
  const runtimeInterviewState = interviewQuery.data;
  const interviewTurnTimestamp = normalized.identity.audit?.timestamp;
  const submitAnswer = useSubmitAssessmentInterviewAnswerMutation(assessmentId);
  const recordBlockedAction =
    useAssessmentInterviewBlockedActionMutation(assessmentId);
  const continuePipeline = useContinueAssessmentPipelineMutation(assessmentId);
  const runtimeControl = useAssessmentRuntimeControl(assessmentId);
  const activeRuntimeControl = useMemo(
    () =>
      selectAssessmentComposerRuntimeControl(
        liveTimeline.canonicalAssessment,
        runtimeControl.control.data,
      ),
    [liveTimeline.canonicalAssessment, runtimeControl.control.data],
  );
  const runtimeControlState = runtimeControl.stop.isPending
    ? ASSESSMENT_RUNTIME_CONTROL_STATES.stopRequested
    : runtimeControl.resume.isPending
      ? ASSESSMENT_RUNTIME_CONTROL_STATES.resumeRequested
      : activeRuntimeControl.state;
  const submitPostFindingDecision =
    useSubmitAssessmentPostFindingDecisionMutation(assessmentId);

  const activeQuestion = interview.activeQuestion;
  const activeQuestionId = activeQuestion?.id ?? "";

  const [draftMap, setDraftMap] = useState<
    Record<string, InterviewAnswerDraft>
  >({});
  const [submittedQuestionId, setSubmittedQuestionId] = useState<string | null>(
    null,
  );
  const [lastSavedMessage, setLastSavedMessage] = useState<string | null>(null);
  const [retainedDrafts, setRetainedDrafts] = useState<Record<string, string>>({});
  const mutationBusy = submitAnswer.isPending || recordBlockedAction.isPending;

  const activeDraft: InterviewAnswerDraft =
    draftMap[assessmentId] &&
    draftMap[assessmentId].questionId === activeQuestionId
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
        activeDraft.isAdjusting === true &&
        activeDraft.freeText.trim().length > 0;
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
      composerPlaceholderKey =
        downstreamPlaceholderKey ?? interviewHandoff.placeholderKey;
    }
  } else if (composerAvailability.isEnabled) {
    composerPlaceholderKey = "pages.assessmentFlow.interview.placeholder";
  } else {
    composerPlaceholderKey =
      downstreamPlaceholderKey ?? interviewHandoff.placeholderKey;
  }

  const answerHistory = interview.answerHistory;
  const interviewTranscript = interleaveInterviewTranscript(answerHistory, [
    {
      stage: ASSESSMENT_AGENT_STREAM_STAGES.interview,
      groups: groupAgentStreamEventsByRun(
        stageEvents.byStage[ASSESSMENT_AGENT_STREAM_STAGES.interview],
      ),
    },
    {
      stage: ASSESSMENT_AGENT_STREAM_STAGES.ruleAnalysis,
      groups: groupAgentStreamEventsByRun(
        stageEvents.byStage[ASSESSMENT_AGENT_STREAM_STAGES.ruleAnalysis],
      ),
    },
    {
      stage: ASSESSMENT_AGENT_STREAM_STAGES.gate,
      groups: groupAgentStreamEventsByRun(
        stageEvents.byStage[ASSESSMENT_AGENT_STREAM_STAGES.gate],
      ),
    },
  ]);
  const scannerTurnEvents = useMemo(
    () =>
      resetScannerActivity
        ? []
        : scopeAgentStreamRunEvents(
            stageEvents.byStage[ASSESSMENT_AGENT_STREAM_STAGES.scanner],
            activeScanRunId,
          ),
    [resetScannerActivity, stageEvents, activeScanRunId],
  );
  const onLoadOlderScannerActivity = () => {
    void workspaceRuntime.loadMoreAgentStreamHistory(assessmentId);
  };
  const scannerHistoryAction = shouldShowAgentStreamHistoryAction(
    liveTimeline.agentStreamHistory,
    onLoadOlderScannerActivity,
  );
  const transcriptTurns = splitCurrentInterviewActivity(
    interviewTranscript,
    interview.questionTurnProps?.question,
  );
  const autoScrollKey = [
    assessmentId,
    runtimeKey,
    workflow.currentRunId,
    workflow.status,
    normalized.workflow.latestRun?.updatedAt ?? workflow.lastEmittedAt,
    liveTimeline.agentStreamEvents?.at(-1)?.eventId,
    runtimeThinkingItems.map((item) => item.id).join("|"),
    interviewQuery.dataUpdatedAt,
    activeQuestionId,
    answerHistory.length,
    interview.assistantMessage,
    postFinding?.screenProjection,
    postFinding?.selectedDecision,
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
      interview.revalidating ||
      mutationBusy ||
      submitAnswer.hasPendingRequest ||
      recordBlockedAction.hasPendingRequest ||
      !runtimeInterviewState
    ) {
      return;
    }
    setLastSavedMessage(null);
    setRetainedDrafts((current) => ({
      ...current,
      [assessmentId]: input.freeText || input.otherText ||
        activeQuestion?.choices?.filter((choice) => input.selectedChoiceIds?.includes(choice.id))
          .map((choice) => choice.label).join(", ") ||
        activeQuestion?.prompt || "",
    }));
    submitAnswer.mutate(
      { answer: input, state: runtimeInterviewState },
      {
        onSuccess: () => {
          setSubmittedQuestionId(input.questionId);
          clearDraft();
          setLastSavedMessage(t("pages.assessment.answerSavedForRuntime"));
        },
      },
    );
  }

  function handleBlockedAction(action: AssessmentInterviewBlockedAction) {
    if (
      !interviewEnabled || !customerActions.canSubmitBlockedAction ||
      !runtimeInterviewState || mutationBusy ||
      submitAnswer.hasPendingRequest || recordBlockedAction.hasPendingRequest
    ) {
      return;
    }
    setLastSavedMessage(null);
    setRetainedDrafts((current) => ({ ...current, [assessmentId]: composerValue }));
    recordBlockedAction.mutate(
      {
        state: runtimeInterviewState,
        blocked: {
          action,
          draft:
            action === ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.saveAndExit
              ? composerValue.trim() || undefined
              : undefined,
        },
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

  function handlePostFindingDecision(decision: RemediationDecision) {
    if (
      !postFinding?.canSelectDecision ||
      submitPostFindingDecision.isPending
    ) {
      return;
    }
    submitPostFindingDecision.mutate({ decision });
  }

  const isComposerDisabled =
    !interviewEnabled ||
    scanFailed ||
    !composerAvailability.isEnabled ||
    interview.stale ||
    interview.revalidating ||
    (activeQuestion?.control === ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust &&
      !activeDraft.isAdjusting);
  const hasComposerDraft = composerValue.trim().length > 0;
  // Continue is offered whenever the pipeline is not waiting on the Customer:
  // the API decides whether a failed/stalled Interview turn or the downstream
  // assessment restarts, and refuses while a worker still owns the pipeline.
  const canContinuePipeline =
    runtimeControlState !== ASSESSMENT_RUNTIME_CONTROL_STATES.running &&
    runtimeControlState !== ASSESSMENT_RUNTIME_CONTROL_STATES.stopRequested &&
    runtimeControlState !== ASSESSMENT_RUNTIME_CONTROL_STATES.resumeRequested &&
    (canonicalLifecycleState ===
      ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN ||
      canonicalLifecycleState ===
        ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_REQUIRED_INPUT ||
      canonicalLifecycleState === ASSESSMENT_LIFECYCLE_STATES.PAUSED ||
      canonicalLifecycleState === ASSESSMENT_LIFECYCLE_STATES.BLOCKED ||
      canonicalLifecycleState === ASSESSMENT_LIFECYCLE_STATES.FAILED) &&
    !scanFailed &&
    !hasComposerDraft &&
    (boundaryPaused ||
      !(customerActions.canAnswerQuestion && activeQuestion)) &&
    !customerActions.canSubmitBlockedAction &&
    (boundaryPaused || !interviewHandoff.isGenuinelyPending) &&
    !submitAnswer.isPending &&
    !recordBlockedAction.isPending &&
    !submitPostFindingDecision.isPending;
  const composerDisabled =
    isComposerDisabled && !canContinuePipeline && !hasComposerDraft;

  function handleContinuePipeline() {
    if (!canContinuePipeline || continuePipeline.isPending) {
      return;
    }
    requestContinuePipeline();
  }

  function requestContinuePipeline() {
    continuePipeline.mutate(undefined, {
      onSuccess: (outcome) => {
        setLastSavedMessage(t(pipelineContinueMessageKey(outcome)));
      },
      onError: () => {
        setLastSavedMessage(t(PIPELINE_CONTINUE_FAILED_MESSAGE_KEY));
      },
    });
  }

  const interviewThinkingLabel = agentThinkingLabel(
    false,
    groupAgentStreamEventsByRun(
      stageEvents.byStage[ASSESSMENT_AGENT_STREAM_STAGES.interview],
    ).at(-1)?.events ?? [],
  );
  const handoffPanel = (
    <InterviewOutputPanel
      icon={InfoIcon}
      label={
        interview.assistantMessage ??
        (interviewHandoff.messageKey ===
        "pages.assessmentFlow.interview.contextReadyHandoff"
          ? t("pages.assessment.noMoreQuestionsOutput")
          : t(interviewHandoff.messageKey))
      }
    />
  );
  // The handoff status belongs to the answer's own agent turn when that turn is
  // the latest thing on screen, so Technical details still ends the turn.
  const lastHistoryTurn = transcriptTurns.history.at(-1);
  const handoffInLatestActivity =
    !interview.questionTurnProps &&
    !interview.isFailed &&
    !(
      interview.isBlocked &&
      customerActions.canSubmitBlockedAction &&
      customerActions.availableBlockedActions.length > 0
    ) &&
    (lastHistoryTurn?.followUpActivity.length ?? 0) > 0;

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
        {scannerTurnEvents.length > 0 || scannerHistoryAction ? (
          <AgentStreamTurn
            // A retried scan is a new run: remount so its disclosures start
            // collapsed instead of inheriting the previous run's DOM state.
            key={`scanner:${activeScanRunId ?? scannerTurnEvents[0]?.runId ?? ""}`}
            stages={[ASSESSMENT_AGENT_STREAM_STAGES.scanner]}
            runId={activeScanRunId ?? scannerTurnEvents[0]?.runId ?? ""}
            events={scannerTurnEvents}
            stageEvents={{
              [ASSESSMENT_AGENT_STREAM_STAGES.scanner]: scannerTurnEvents,
            }}
            outcomeOverride={
              scannerActive
                ? undefined
                : scanFailed
                  ? AGENT_STREAM_RUN_OUTCOMES.failed
                  : AGENT_STREAM_RUN_OUTCOMES.completed
            }
            history={liveTimeline.agentStreamHistory}
            onLoadOlder={onLoadOlderScannerActivity}
          />
        ) : null}

        <InterviewMutationFeedback
          error={submitAnswer.error ?? recordBlockedAction.error}
          busy={mutationBusy || interviewQuery.isFetching}
          retainedDraft={retainedDrafts[assessmentId]}
          canRetryOriginal={submitAnswer.hasPendingRequest || recordBlockedAction.hasPendingRequest}
          onRetryOriginal={() => {
            if (mutationBusy) return;
            if (submitAnswer.hasPendingRequest) submitAnswer.mutate(undefined);
            else if (recordBlockedAction.hasPendingRequest) recordBlockedAction.mutate(undefined);
          }}
          onRefresh={() => { void interviewQuery.refetch(); }}
        />

        {interviewEnabled ? (
          <>
            {transcriptTurns.currentActivity.map((segment) => (
              <AgentStreamDispatchTurns
                key={`activity:${segment.turnKey}`}
                segment={segment}
                runtimeControl={activeRuntimeControl}
              />
            ))}

            {transcriptTurns.history.map((turn, turnIndex) => {
              const lastSegment = turn.followUpActivity.length - 1;
              const ownsHandoff =
                handoffInLatestActivity &&
                turnIndex === transcriptTurns.history.length - 1;
              return (
                <InterviewCycleTurn
                  key={`answer:${turn.answer.questionId}:${turn.answer.answeredAt}`}
                  cycle={turn}
                  activityOwnsOutput={lastSegment >= 0}
                  activity={turn.followUpActivity.map((segment, index) => (
                    <AgentStreamDispatchTurns
                      key={`activity:${segment.turnKey}`}
                      segment={segment}
                      runtimeControl={activeRuntimeControl}
                      outputs={
                        // The answer's result belongs to the dispatch that
                        // processed it, not to later retries appended after it.
                        index === 0 ? (
                          <>
                            <InterviewCycleOutput
                              answer={turn.answer}
                              question={turn.question}
                            />
                            {ownsHandoff ? handoffPanel : null}
                          </>
                        ) : undefined
                      }
                    />
                  ))}
                />
              );
            })}

            {interview.questionTurnProps ? (
              <AgentTurn
                content={
                  <AgentMessage>
                    <ThoughtLine label={interviewThinkingLabel} />
                    <p className="mt-2">
                      {t("pages.assessmentFlow.interview.readyDescription")}
                    </p>
                  </AgentMessage>
                }
                footer={
                  interviewTurnTimestamp ? (
                    <TurnFooter timestamp={interviewTurnTimestamp} />
                  ) : null
                }
                terminalAction={
                  <AssessmentQuestionTurn
                    assessmentId={assessmentId}
                    question={interview.questionTurnProps.question}
                    answerHistoryVisible={answerHistory.length > 0}
                    selectedChoiceIds={activeDraft.selectedChoiceIds}
                    onSelectedChoiceIdsChange={handleSelectedChoicesChange}
                    isAdjusting={activeDraft.isAdjusting}
                    onAdjust={handleAdjust}
                    canSubmitSelection={isSubmitReady}
                    hideSubmitSelection={
                      submittedQuestionId === activeQuestion?.id
                    }
                    onSubmitSelection={handleSubmit}
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
                    <ThoughtLine label={interviewThinkingLabel} />
                    <p className="mt-2">
                      {t("pages.assessmentFlow.interview.readyDescription")}
                    </p>
                    <p className="mt-2 text-muted-foreground">
                      {t("pages.assessment.blockedActionRecorded")}
                    </p>
                  </AgentMessage>
                }
                footer={
                  interviewTurnTimestamp ? (
                    <TurnFooter timestamp={interviewTurnTimestamp} />
                  ) : null
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
              <AgentTurn
                footer={
                  interviewTurnTimestamp ? (
                    <TurnFooter timestamp={interviewTurnTimestamp} />
                  ) : null
                }
              >
                <AgentMessage className="font-medium text-destructive">
                  {t("pages.appShell.chatActivityStatuses.failed")}
                </AgentMessage>
              </AgentTurn>
            ) : handoffInLatestActivity ? null : (
              <AgentTurn
                footer={
                  interviewTurnTimestamp ? (
                    <TurnFooter timestamp={interviewTurnTimestamp} />
                  ) : null
                }
              >
                <AgentMessage>{handoffPanel}</AgentMessage>
              </AgentTurn>
            )}

            <AgentStreamTimeline events={stageEvents.unstaged} />

            {postFinding ? (
              <AgentTurn
                content={
                  <AgentMessage>
                    <ThoughtLine label={agentThinkingLabel(false, [])} />
                    <p className="mt-2">
                      {t("pages.assessmentFlow.postFinding.description")}
                    </p>
                  </AgentMessage>
                }
                terminalAction={
                  <PostFindingFlowSteps
                    postFinding={postFinding}
                    artifacts={{
                      remediationPatch: normalized.artifacts.remediationPatch,
                      verificationReport:
                        normalized.artifacts.verificationReport,
                      finalReport: normalized.artifacts.finalReport,
                    }}
                    disabled={
                      submitAnswer.isPending ||
                      recordBlockedAction.isPending ||
                      submitPostFindingDecision.isPending
                    }
                    onDecisionSelect={handlePostFindingDecision}
                  />
                }
              />
            ) : null}

            {lastSavedMessage ? (
              <AgentTurn>
                <AgentMessage className="text-muted-foreground">
                  {lastSavedMessage}
                </AgentMessage>
              </AgentTurn>
            ) : null}
          </>
        ) : (
          <AgentStreamTimeline events={stageEvents.unstaged} />
        )}
      </AssessmentTranscript>

      <AssessmentComposer
        value={composerValue}
        disabled={composerDisabled}
        submitReady={isSubmitReady}
        submitting={submitAnswer.isPending || recordBlockedAction.isPending}
        resuming={continuePipeline.isPending}
        resumeAvailable={canContinuePipeline || continuePipeline.isPending}
        resumeLabel={t("pages.assessment.resumePipeline")}
        placeholder={t(composerPlaceholderKey)}
        onValueChange={handleComposerValueChange}
        onSubmit={handleSubmit}
        onResume={handleContinuePipeline}
        runtimeControlState={runtimeControlState}
        onInterruptTurn={() =>
          runtimeControl.stop.mutate(activeRuntimeControl.targetRunId, {
            onError: () =>
              setLastSavedMessage(t(PIPELINE_CONTINUE_FAILED_MESSAGE_KEY)),
          })
        }
        onResumeTurn={() =>
          runtimeControl.resume.mutate(activeRuntimeControl.targetRunId, {
            onError: () =>
              setLastSavedMessage(t(PIPELINE_CONTINUE_FAILED_MESSAGE_KEY)),
          })
        }
        interruptingTurn={runtimeControl.stop.isPending}
        resumingTurn={runtimeControl.resume.isPending}
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
