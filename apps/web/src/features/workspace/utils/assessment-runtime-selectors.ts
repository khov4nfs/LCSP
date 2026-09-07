import {
  ASSESSMENT_INTERVIEW_OUTCOMES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  ASSESSMENT_RUNTIME_STAGE_CODES,
  ASSESSMENT_TECHNICAL_COVERAGE_STATES,
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
import type { WorkspaceRuntimeRepositorySnapshot } from "../types/workspace-runtime.types";

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

export function selectRightSidebarPresentation(
  normalized: NormalizedAssessmentRuntime,
) {
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

  const activeStage =
    activeRun?.stage ?? activeActivity?.stage ?? workflow.stage;
  const activeStatus =
    activeRun?.status ?? activeActivity?.runStatus ?? workflow.status;
  const activeSummary = activeActivity?.summary ?? null;
  const activeUpdatedAt =
    activeActivity?.emittedAt ?? activeRun?.updatedAt ?? workflow.lastEmittedAt;

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
  const scannerStatus = input.scanner.scanFailed
    ? ASSESSMENT_SIDEBAR_STATUSES.failed
    : input.scanner.evidenceAccepted
      ? ASSESSMENT_SIDEBAR_STATUSES.passed
      : ASSESSMENT_SIDEBAR_STATUSES.running;
  const interviewRunning =
    normalized.interview.outcome ===
      ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer &&
    normalized.interview.activeQuestion !== null;
  const interviewStatus = input.scanner.evidenceAccepted
    ? interviewRunning
      ? ASSESSMENT_SIDEBAR_STATUSES.running
      : ASSESSMENT_SIDEBAR_STATUSES.waiting
    : ASSESSMENT_SIDEBAR_STATUSES.queued;
  const workflow: NormalizedAssessmentSidebarWorkflowItem[] = [
    sidebarWorkflowItem(
      ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.scanner,
      "pages.appShell.assessmentSidebar.workflow.scanner",
      scannerStatus,
    ),
    sidebarWorkflowItem(
      ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.interview,
      "pages.appShell.assessmentSidebar.workflow.interview",
      interviewStatus,
    ),
    sidebarWorkflowItem(
      ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.rules,
      "pages.appShell.assessmentSidebar.workflow.rules",
      ASSESSMENT_SIDEBAR_STATUSES.queued,
    ),
    sidebarWorkflowItem(
      ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.planner,
      "pages.appShell.assessmentSidebar.workflow.planner",
      ASSESSMENT_SIDEBAR_STATUSES.queued,
    ),
    sidebarWorkflowItem(
      ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.investigate,
      "pages.appShell.assessmentSidebar.workflow.investigate",
      ASSESSMENT_SIDEBAR_STATUSES.queued,
    ),
    sidebarWorkflowItem(
      ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.gate,
      "pages.appShell.assessmentSidebar.workflow.gate",
      ASSESSMENT_SIDEBAR_STATUSES.queued,
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
  const servicesCount = programEvidenceSummary?.servicesScanned.value ?? null;
  const programEvidenceDescriptionKey =
    servicesCount === null
      ? "pages.appShell.assessmentSidebar.artifacts.programEvidenceGraphBuilding"
      : "pages.appShell.assessmentSidebar.artifacts.programEvidenceGraphServices";

  return [
    {
      id: normalized.artifacts.programEvidenceGraph.id,
      labelKey:
        "pages.appShell.assessmentSidebar.artifacts.programEvidenceGraph",
      descriptionKey: programEvidenceDescriptionKey,
      descriptionParams:
        servicesCount === null ? undefined : { count: String(servicesCount) },
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
          assessmentId: normalized.artifacts.programEvidenceGraph.ref.assessmentId,
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
    screenProjection: postFindingScreenProjection(postFinding.phase),
  };
}

export function selectComposerAvailability(
  normalized: NormalizedAssessmentRuntime,
) {
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

export function selectInterviewHandoffPresentation(
  normalized: NormalizedAssessmentRuntime,
) {
  const interview = selectInterviewPresentation(normalized);
  const hasCustomerVisibleTurn =
    Boolean(interview.questionTurnProps) || interview.isBlocked;
  const isStartupPending = !hasCustomerVisibleTurn;
  const messageKey =
    normalized.availability === ASSESSMENT_RUNTIME_AVAILABILITIES.loading
      ? "pages.assessment.loadingInterviewState"
      : interview.orchestrationRequested
        ? "pages.assessmentFlow.interview.startingDescription"
        : "pages.assessmentFlow.interview.pendingDescription";

  return {
    isStartupPending,
    messageKey,
    placeholderKey: interview.orchestrationRequested
      ? "pages.assessmentFlow.interview.startingPlaceholder"
      : "pages.assessmentFlow.interview.pendingPlaceholder",
  };
}

export function selectAssessmentScreenProjection(
  normalized: NormalizedAssessmentRuntime,
): AssessmentScreenProjection {
  const { coverage, interview, workflow } = normalized;

  if (normalized.postFinding !== null) {
    return postFindingScreenProjection(normalized.postFinding.phase);
  }

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

  return ASSESSMENT_SCREEN_PROJECTIONS.f03;
}

function postFindingScreenProjection(
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
