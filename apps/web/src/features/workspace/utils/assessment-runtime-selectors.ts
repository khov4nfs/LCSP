import {
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_INTERVIEW_OUTCOMES,
  INTERVIEW_PROGRESS_PHASES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  POST_FINDING_RUNTIME_PHASES,
} from "@lcsp/contracts/evidence";

import type { ProgramEvidenceSummary } from "../../assessment-flow/types/assessment-flow.types";
import {
  ARTIFACT_STATUSES,
  ARTIFACT_TYPES,
} from "../../artifacts/types/artifact.types";

import {
  ASSESSMENT_ARTIFACT_AVAILABILITIES,
  ASSESSMENT_RUNTIME_AVAILABILITIES,
  ASSESSMENT_SCREEN_PROJECTIONS,
  ASSESSMENT_SIDEBAR_STATUSES,
  ASSESSMENT_SIDEBAR_WORKFLOW_STAGES,
  NORMALIZED_ARTIFACT_CATEGORIES,
  type AssessmentScreenProjection,
  type AssessmentSidebarStatus,
  type NormalizedAssessmentSidebarArtifactItem,
  type NormalizedAssessmentSidebarPresentation,
  type NormalizedAssessmentSidebarWorkflowItem,
  type NormalizedAssessmentRuntime,
} from "../types/assessment-runtime-adapter.types";
import { projectRuntimeThinking } from "./runtime-thinking-projection";
import type {
  RuntimeThinkingItem,
  WorkspaceRuntimeRepositorySnapshot,
} from "../types/workspace-runtime.types";

export function selectInterviewPresentation(
  normalized: NormalizedAssessmentRuntime,
) {
  const interview = normalized.interview;
  const isWaiting =
    interview.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer;
  const hasActiveQuestion = isWaiting && interview.activeQuestion !== null;

  return {
    outcome: interview.outcome,
    activeQuestion: interview.activeQuestion,
    assistantMessage:
      interview.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.contextReady ||
      interview.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved
        ? interview.assistantMessage
        : null,
    hasActiveQuestion,
    isWaitingForCustomer: isWaiting,
    isContextReady:
      interview.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
    isContextResolved:
      interview.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved,
    isBlocked:
      interview.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved,
    isFailed: interview.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.failed,
    hasDownstreamImpact: interview.hasDownstreamImpact,
    contextAuthority: interview.contextAuthority,
    blockedActions: interview.blockedActions,
    answerHistory: interview.answerHistory,
    pendingDraft: interview.pendingDraft,
    orchestrationRequested: interview.orchestrationRequested,
    stale: interview.stale,
    revalidating: interview.revalidating,
    questionTurnProps:
      hasActiveQuestion && interview.activeQuestion
        ? {
            question: interview.activeQuestion,
            blockedActions: interview.blockedActions,
          }
        : null,
  };
}

export function selectWorkflowPresentation(
  normalized: NormalizedAssessmentRuntime,
) {
  const workflow = normalized.workflow;
  const executionState =
    normalized.canonicalAssessment?.runtime?.executionState ?? null;
  const hasActiveRun =
    executionState === AGENT_EXECUTION_STATES.QUEUED ||
    executionState === AGENT_EXECUTION_STATES.RUNNING ||
    executionState === AGENT_EXECUTION_STATES.INTERRUPTED ||
    executionState === AGENT_EXECUTION_STATES.PAUSED;
  const activeRun = hasActiveRun ? workflow.latestRun : null;
  const activeActivity =
    workflow.recentActivity.find(
      (item) =>
        item.runStatus === ASSESSMENT_RUNTIME_RUN_STATUSES.running ||
        item.runStatus === ASSESSMENT_RUNTIME_RUN_STATUSES.waiting,
    ) ?? null;
  const activeStage =
    activeRun?.stage ?? activeActivity?.stage ?? workflow.stage;
  const activeStatus = executionState;

  return {
    stage: workflow.stage,
    status: executionState,
    activeStage,
    activeStatus,
    currentRunId: workflow.currentRunId,
    activeTools: workflow.activeTools,
    recentActivity: workflow.recentActivity,
    isTargetedClarificationLoop: workflow.isTargetedClarificationLoop,
    hasActiveRun,
    lastEmittedAt: workflow.lastEmittedAt,
  };
}

export function selectRuntimeThinkingItems(
  normalized: NormalizedAssessmentRuntime,
): RuntimeThinkingItem[] {
  return projectRuntimeThinking(
    normalized.workflow.recentActivity,
    normalized.workflow.engineeringProgress,
  );
}

export function selectRightSidebarPresentation(
  normalized: NormalizedAssessmentRuntime,
) {
  const presentation = selectWorkflowPresentation(normalized);
  const workflow = normalized.workflow;
  const activeRun = presentation.hasActiveRun ? workflow.latestRun : null;
  const activeActivity =
    workflow.recentActivity.find(
      (item) =>
        item.runStatus === ASSESSMENT_RUNTIME_RUN_STATUSES.running ||
        item.runStatus === ASSESSMENT_RUNTIME_RUN_STATUSES.waiting,
    ) ?? null;
  const activeSummary = activeActivity?.summary ?? null;
  const activeUpdatedAt =
    activeActivity?.emittedAt ?? activeRun?.updatedAt ?? workflow.lastEmittedAt;

  return {
    connectionState: normalized.connectionState,
    activeRun,
    activeActivity,
    activeStage: presentation.activeStage,
    activeStatus: presentation.activeStatus,
    activeSummary,
    activeUpdatedAt,
    artifacts: normalized.artifacts.items,
    programEvidenceGraph: normalized.artifacts.programEvidenceGraph,
    businessContext: normalized.artifacts.businessContext,
    investigationNotes: normalized.artifacts.investigationNotes,
  };
}

export function selectAssessmentRuntimeSidebarPresentation(
  normalized: NormalizedAssessmentRuntime,
  input: {
    repository: WorkspaceRuntimeRepositorySnapshot | null;
    scanner: {
      evidenceAccepted: boolean;
      scanFailed: boolean;
      programEvidenceSummary?: ProgramEvidenceSummary;
    };
  },
): NormalizedAssessmentSidebarPresentation {
  const workflow: NormalizedAssessmentSidebarWorkflowItem[] = [
    sidebarWorkflowItem(
      ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.scanner,
      "pages.appShell.assessmentSidebar.workflow.scanner",
      ASSESSMENT_SIDEBAR_STATUSES.unavailable,
    ),
    sidebarWorkflowItem(
      ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.interview,
      "pages.appShell.assessmentSidebar.workflow.interview",
      ASSESSMENT_SIDEBAR_STATUSES.unavailable,
    ),
    sidebarWorkflowItem(
      ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.rules,
      "pages.appShell.assessmentSidebar.workflow.rules",
      ASSESSMENT_SIDEBAR_STATUSES.unavailable,
    ),
    sidebarWorkflowItem(
      ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.ruleAnalysis,
      "pages.appShell.assessmentSidebar.workflow.ruleAnalysis",
      ASSESSMENT_SIDEBAR_STATUSES.unavailable,
    ),
    sidebarWorkflowItem(
      ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.gate,
      "pages.appShell.assessmentSidebar.workflow.gate",
      ASSESSMENT_SIDEBAR_STATUSES.unavailable,
    ),
  ];
  const artifacts = input.scanner.evidenceAccepted
    ? sidebarReadyArtifacts(normalized)
    : sidebarScannerArtifacts(normalized, input.scanner.programEvidenceSummary);

  return {
    repository: input.repository
      ? {
          repositoryFullName: input.repository.repositoryFullName,
          branch: input.repository.branch,
          commitSha: input.repository.commitSha,
        }
      : null,
    workflow,
    artifacts,
    artifactSummaryKey: input.scanner.evidenceAccepted
      ? "pages.appShell.assessmentSidebar.artifactSummary.readyWaiting"
      : "pages.appShell.assessmentSidebar.artifactSummary.active",
  };
}

function sidebarWorkflowItem(
  id: NormalizedAssessmentSidebarWorkflowItem["id"],
  labelKey: string,
  status: AssessmentSidebarStatus,
): NormalizedAssessmentSidebarWorkflowItem {
  return { id, labelKey, status };
}

function sidebarScannerArtifacts(
  normalized: NormalizedAssessmentRuntime,
  programEvidenceSummary?: ProgramEvidenceSummary,
): NormalizedAssessmentSidebarArtifactItem[] {
  const modulesCount = programEvidenceSummary?.modulesAnalyzed.value ?? null;
  const programEvidenceDescriptionKey =
    modulesCount === null
      ? "pages.appShell.assessmentSidebar.artifacts.programEvidenceGraphBuilding"
      : "pages.appShell.assessmentSidebar.artifacts.programEvidenceGraphServices";

  return [
    {
      id: normalized.artifacts.programEvidenceGraph.id,
      labelKey:
        "pages.appShell.assessmentSidebar.artifacts.programEvidenceGraph",
      descriptionKey: programEvidenceDescriptionKey,
      descriptionParams:
        modulesCount === null ? undefined : { count: String(modulesCount) },
      status: ASSESSMENT_SIDEBAR_STATUSES.building,
      artifact: {
        ...normalized.artifacts.programEvidenceGraph,
        availability: ASSESSMENT_ARTIFACT_AVAILABILITIES.updating,
      },
    },
    {
      id: "collected-evidence",
      labelKey: "pages.appShell.assessmentSidebar.artifacts.collectedEvidence",
      descriptionKey:
        "pages.appShell.assessmentSidebar.artifacts.collectedEvidenceRunning",
      status: ASSESSMENT_SIDEBAR_STATUSES.running,
      artifact: {
        id: "collected-evidence",
        kind: "COLLECTED_EVIDENCE",
        ref: {
          assessmentId:
            normalized.artifacts.programEvidenceGraph.ref.assessmentId,
          type: ARTIFACT_TYPES.technicalEvidence,
        },
        type: ARTIFACT_TYPES.technicalEvidence,
        status: ARTIFACT_STATUSES.updating,
        category: NORMALIZED_ARTIFACT_CATEGORIES.technicalEvidence,
        labelKey: "artifacts.collectedEvidence.label",
        availability: ASSESSMENT_ARTIFACT_AVAILABILITIES.updating,
        customerSafeSummary: null,
      },
    },
  ];
}

function sidebarReadyArtifacts(
  normalized: NormalizedAssessmentRuntime,
): NormalizedAssessmentSidebarArtifactItem[] {
  return [
    {
      id: normalized.artifacts.programEvidenceGraph.id,
      labelKey:
        "pages.appShell.assessmentSidebar.artifacts.programEvidenceGraph",
      descriptionKey:
        "pages.appShell.assessmentSidebar.artifacts.programEvidenceGraphReady",
      status: ASSESSMENT_SIDEBAR_STATUSES.ready,
      artifact: normalized.artifacts.programEvidenceGraph,
    },
    {
      id: normalized.artifacts.businessContext.id,
      labelKey: "pages.appShell.assessmentSidebar.artifacts.projectContext",
      descriptionKey:
        "pages.appShell.assessmentSidebar.artifacts.projectContextWaiting",
      status: ASSESSMENT_SIDEBAR_STATUSES.waiting,
      artifact: normalized.artifacts.businessContext,
    },
  ];
}

export function selectArtifactPresentation(
  normalized: NormalizedAssessmentRuntime,
) {
  return normalized.artifacts;
}

export function selectCustomerActions(normalized: NormalizedAssessmentRuntime) {
  return normalized.customerActions;
}

export function selectPostFindingPresentation(
  normalized: NormalizedAssessmentRuntime,
) {
  const postFinding = normalized.postFinding;
  if (postFinding === null) {
    return null;
  }

  return {
    ...postFinding,
    canSelectDecision: normalized.customerActions.canSelectRemediationDecision,
    // This is the secondary remediation-flow marker; assessment screen state
    // remains selected exclusively by selectAssessmentScreenProjection.
    screenProjection: postFindingFlowProjection(postFinding.phase),
  };
}

export function selectComposerAvailability(
  normalized: NormalizedAssessmentRuntime,
) {
  const actions = normalized.customerActions;
  const isEnabled = actions.canUseComposer;
  const placeholderKey = actions.canAnswerQuestion
    ? "pages.appShell.chatComposerPlaceholder"
    : "pages.assessment.noActiveInterviewQuestion";

  return {
    isEnabled,
    placeholderKey,
    canSubmit: actions.canSubmitDraft,
  };
}

export function selectInterviewHandoffPresentation(
  normalized: NormalizedAssessmentRuntime,
) {
  const interview = selectInterviewPresentation(normalized);
  const hasCustomerVisibleTurn =
    Boolean(interview.questionTurnProps) || interview.isBlocked;
  const isStartupPending = !hasCustomerVisibleTurn;
  const phaseKeys = {
    [INTERVIEW_PROGRESS_PHASES.queued]:
      "pages.assessmentFlow.interview.progressQueued",
    [INTERVIEW_PROGRESS_PHASES.running]:
      "pages.assessmentFlow.interview.progressRunning",
    [INTERVIEW_PROGRESS_PHASES.toolRunning]:
      "pages.assessmentFlow.interview.progressTool",
    [INTERVIEW_PROGRESS_PHASES.completed]:
      "pages.assessmentFlow.interview.progressCompleted",
    [INTERVIEW_PROGRESS_PHASES.failed]:
      "pages.assessmentFlow.interview.progressFailed",
  };
  const progress = [...normalized.workflow.recentActivity]
    .sort((a, b) => b.emittedAt.localeCompare(a.emittedAt))
    .map((event) => {
      const output = event.outputSummary;
      if (!output || typeof output !== "object" || Array.isArray(output))
        return null;
      const item = output.interviewProgress;
      return item && typeof item === "object" && !Array.isArray(item)
        ? item
        : null;
    })
    .find(
      (item) => item?.contextRevision === normalized.identity.contextRevision,
    );
  const progressKey =
    progress &&
    typeof progress.phase === "string" &&
    Object.hasOwn(phaseKeys, progress.phase)
      ? phaseKeys[progress.phase as keyof typeof phaseKeys]
      : null;
  const messageKey =
    normalized.availability === ASSESSMENT_RUNTIME_AVAILABILITIES.loading
      ? "pages.assessment.loadingInterviewState"
      : interview.isContextReady
        ? "pages.assessmentFlow.interview.contextReadyHandoff"
        : interview.isContextResolved
          ? "pages.assessmentFlow.interview.contextResolvedHandoff"
          : progressKey
            ? progressKey
            : interview.answerHistory.length > 0
              ? "pages.assessmentFlow.interview.continuingDescription"
              : interview.orchestrationRequested
                ? "pages.assessmentFlow.interview.startingDescription"
                : "pages.assessmentFlow.interview.pendingDescription";

  // The answer is saved but the Interview Agent turn failed: offer Resume.
  const canResumeFailedTurn =
    isStartupPending &&
    progress?.phase === INTERVIEW_PROGRESS_PHASES.failed &&
    messageKey === progressKey;

  // True only in the freshest possible state: nothing has ever run for this
  // Interview yet (no orchestration requested, no progress event, no answer
  // on record). There is nothing to continue here, so Pipeline Continue must
  // stay hidden instead of offering to restart a pipeline that simply hasn't
  // been dispatched yet.
  const isGenuinelyPending =
    messageKey === "pages.assessmentFlow.interview.pendingDescription";

  return {
    isStartupPending,
    canResumeFailedTurn,
    isGenuinelyPending,
    messageKey,
    placeholderKey: canResumeFailedTurn
      ? "pages.assessmentFlow.interview.resumeFailedPlaceholder"
      : interview.orchestrationRequested
        ? "pages.assessmentFlow.interview.startingPlaceholder"
        : "pages.assessmentFlow.interview.pendingPlaceholder",
  };
}

export function selectAssessmentScreenProjection(
  normalized: NormalizedAssessmentRuntime,
): AssessmentScreenProjection {
  const { interview } = normalized;
  const canonical = normalized.canonicalAssessment;
  const lifecycleState = canonical?.lifecycle?.state;
  const canonicalAvailable =
    canonical?.lifecycle != null && canonical.runtime != null;

  if (!canonicalAvailable || lifecycleState === undefined) {
    return ASSESSMENT_SCREEN_PROJECTIONS.f01;
  }

  if (
    lifecycleState === ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN ||
    lifecycleState === ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_REQUIRED_INPUT
  ) {
    if (normalized.workflow.isTargetedClarificationLoop) {
      return ASSESSMENT_SCREEN_PROJECTIONS.f09;
    }
    if (
      interview.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer
    ) {
      if (interview.activeQuestion) {
        return ASSESSMENT_SCREEN_PROJECTIONS.f04;
      }
      return ASSESSMENT_SCREEN_PROJECTIONS.f03;
    }

    if (interview.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved) {
      return ASSESSMENT_SCREEN_PROJECTIONS.f06;
    }

    if (interview.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.contextReady) {
      return ASSESSMENT_SCREEN_PROJECTIONS.f07;
    }

    if (
      interview.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved
    ) {
      return ASSESSMENT_SCREEN_PROJECTIONS.f05;
    }
  }
  if (
    lifecycleState === ASSESSMENT_LIFECYCLE_STATES.COMPLETE ||
    lifecycleState === ASSESSMENT_LIFECYCLE_STATES.FAILED ||
    lifecycleState === ASSESSMENT_LIFECYCLE_STATES.CANCELLED ||
    lifecycleState === ASSESSMENT_LIFECYCLE_STATES.BLOCKED
  ) {
    return ASSESSMENT_SCREEN_PROJECTIONS.f01;
  }
  return ASSESSMENT_SCREEN_PROJECTIONS.f03;
}

function postFindingFlowProjection(
  phase: NonNullable<NormalizedAssessmentRuntime["postFinding"]>["phase"],
): AssessmentScreenProjection {
  switch (phase) {
    case POST_FINDING_RUNTIME_PHASES.codeReview:
      return ASSESSMENT_SCREEN_PROJECTIONS.f11;
    case POST_FINDING_RUNTIME_PHASES.needsInput:
      return ASSESSMENT_SCREEN_PROJECTIONS.f12;
    case POST_FINDING_RUNTIME_PHASES.existingPr:
      return ASSESSMENT_SCREEN_PROJECTIONS.f13;
    case POST_FINDING_RUNTIME_PHASES.createPr:
      return ASSESSMENT_SCREEN_PROJECTIONS.f14;
    case POST_FINDING_RUNTIME_PHASES.verification:
      return ASSESSMENT_SCREEN_PROJECTIONS.f15;
    case POST_FINDING_RUNTIME_PHASES.final:
      return ASSESSMENT_SCREEN_PROJECTIONS.f16;
  }
}
