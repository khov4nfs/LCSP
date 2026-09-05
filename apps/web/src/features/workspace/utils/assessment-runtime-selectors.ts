import {
  ASSESSMENT_INTERVIEW_OUTCOMES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  ASSESSMENT_RUNTIME_STAGE_CODES,
  ASSESSMENT_TECHNICAL_COVERAGE_STATES,
} from "@lcsp/contracts/evidence";

import {
  ASSESSMENT_RUNTIME_AVAILABILITIES,
  ASSESSMENT_SCREEN_PROJECTIONS,
  type AssessmentScreenProjection,
  type NormalizedAssessmentRuntime,
} from "../types/assessment-runtime-adapter.types";

export function selectInterviewPresentation(normalized: NormalizedAssessmentRuntime) {
  const interview = normalized.interview;
  const isWaiting = interview.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer;
  const hasActiveQuestion = isWaiting && interview.activeQuestion !== null;

  return {
    outcome: interview.outcome,
    activeQuestion: interview.activeQuestion,
    hasActiveQuestion,
    isWaitingForCustomer: isWaiting,
    isContextReady: interview.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
    isContextResolved: interview.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved,
    isBlocked: interview.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved,
    isFailed: interview.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.failed,
    hasDownstreamImpact: interview.hasDownstreamImpact,
    contextAuthority: interview.contextAuthority,
    blockedActions: interview.blockedActions,
    answerHistory: interview.answerHistory,
    pendingDraft: interview.pendingDraft,
    orchestrationRequested: interview.orchestrationRequested,
    stale: interview.stale,
    revalidating: interview.revalidating,
    questionTurnProps: hasActiveQuestion && interview.activeQuestion
      ? {
          question: interview.activeQuestion,
          blockedActions: interview.blockedActions,
        }
      : null,
  };
}

export function selectWorkflowPresentation(normalized: NormalizedAssessmentRuntime) {
  const workflow = normalized.workflow;
  const hasActiveRun =
    workflow.status === ASSESSMENT_RUNTIME_RUN_STATUSES.running ||
    workflow.status === ASSESSMENT_RUNTIME_RUN_STATUSES.waiting;

  return {
    stage: workflow.stage,
    status: workflow.status,
    currentRunId: workflow.currentRunId,
    activeTools: workflow.activeTools,
    recentActivity: workflow.recentActivity,
    isTargetedClarificationLoop: workflow.isTargetedClarificationLoop,
    hasActiveRun,
    lastEmittedAt: workflow.lastEmittedAt,
  };
}

export function selectRightSidebarPresentation(normalized: NormalizedAssessmentRuntime) {
  const workflow = normalized.workflow;
  const activeRun =
    workflow.status === ASSESSMENT_RUNTIME_RUN_STATUSES.running ||
    workflow.status === ASSESSMENT_RUNTIME_RUN_STATUSES.waiting
      ? workflow.latestRun
      : null;

  const activeActivity =
    workflow.recentActivity.find(
      (item) =>
        item.runStatus === ASSESSMENT_RUNTIME_RUN_STATUSES.running ||
        item.runStatus === ASSESSMENT_RUNTIME_RUN_STATUSES.waiting,
    ) ?? null;

  const activeStage = activeRun?.stage ?? activeActivity?.stage ?? workflow.stage;
  const activeStatus = activeRun?.status ?? activeActivity?.runStatus ?? workflow.status;
  const activeSummary = activeActivity?.summary ?? null;
  const activeUpdatedAt =
    activeActivity?.emittedAt ??
    activeRun?.updatedAt ??
    workflow.lastEmittedAt;

  return {
    connectionState: normalized.connectionState,
    activeRun,
    activeActivity,
    activeStage,
    activeStatus,
    activeSummary,
    activeUpdatedAt,
    artifacts: normalized.artifacts.items,
    programEvidenceGraph: normalized.artifacts.programEvidenceGraph,
    businessContext: normalized.artifacts.businessContext,
    investigationNotes: normalized.artifacts.investigationNotes,
  };
}

export function selectArtifactPresentation(normalized: NormalizedAssessmentRuntime) {
  return normalized.artifacts;
}

export function selectCustomerActions(normalized: NormalizedAssessmentRuntime) {
  return normalized.customerActions;
}

export function selectComposerAvailability(normalized: NormalizedAssessmentRuntime) {
  const actions = normalized.customerActions;
  const isEnabled =
    actions.canUseComposer &&
    normalized.availability === ASSESSMENT_RUNTIME_AVAILABILITIES.ready;
  const placeholderKey = actions.canAnswerQuestion
    ? "pages.appShell.chatComposerPlaceholder"
    : "pages.assessment.noActiveInterviewQuestion";

  return {
    isEnabled,
    placeholderKey,
    canSubmit: actions.canSubmitDraft,
  };
}

export function selectAssessmentScreenProjection(
  normalized: NormalizedAssessmentRuntime,
): AssessmentScreenProjection {
  const { coverage, interview, workflow } = normalized;

  // Targeted loop: Investigator paused + Interview running
  if (workflow.isTargetedClarificationLoop) {
    return ASSESSMENT_SCREEN_PROJECTIONS.f09;
  }

  // Unavailable coverage or early setup
  if (coverage.state === ASSESSMENT_TECHNICAL_COVERAGE_STATES.unavailable) {
    return ASSESSMENT_SCREEN_PROJECTIONS.f01;
  }

  // Scan in progress
  if (
    workflow.stage === ASSESSMENT_RUNTIME_STAGE_CODES.scan &&
    workflow.status === ASSESSMENT_RUNTIME_RUN_STATUSES.running
  ) {
    return ASSESSMENT_SCREEN_PROJECTIONS.f03;
  }

  // Scan complete, Initial Interview
  if (
    coverage.state === ASSESSMENT_TECHNICAL_COVERAGE_STATES.ready ||
    coverage.state === ASSESSMENT_TECHNICAL_COVERAGE_STATES.partial
  ) {
    if (interview.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer) {
      if (interview.activeQuestion) {
        return ASSESSMENT_SCREEN_PROJECTIONS.f05;
      }
      return ASSESSMENT_SCREEN_PROJECTIONS.f04;
    }

    if (interview.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved) {
      return ASSESSMENT_SCREEN_PROJECTIONS.f06;
    }

    if (interview.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.contextReady) {
      return ASSESSMENT_SCREEN_PROJECTIONS.f07;
    }

    if (interview.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved) {
      return ASSESSMENT_SCREEN_PROJECTIONS.f05;
    }
  }

  // Stage-based projections
  if (
    workflow.stage === "INVESTIGATE" ||
    workflow.stage === "investigate" ||
    workflow.stage === ASSESSMENT_RUNTIME_STAGE_CODES.classification
  ) {
    return ASSESSMENT_SCREEN_PROJECTIONS.f10;
  }

  if (workflow.stage === ASSESSMENT_RUNTIME_STAGE_CODES.documents) {
    return ASSESSMENT_SCREEN_PROJECTIONS.f14;
  }

  return ASSESSMENT_SCREEN_PROJECTIONS.f04;
}
