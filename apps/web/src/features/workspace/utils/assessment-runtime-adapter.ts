import {
  ASSESSMENT_ARTIFACT_STATUSES,
  ASSESSMENT_CONTEXT_AUTHORITY_STATUSES,
  ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS,
  ASSESSMENT_INTERVIEW_FLAGS,
  ASSESSMENT_INTERVIEW_OUTCOMES,
  ASSESSMENT_INTERVIEW_QUESTION_INTENTS,
  ASSESSMENT_RUNTIME_EVENT_TYPES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  ASSESSMENT_RUNTIME_STAGE_CODES,
  ASSESSMENT_TECHNICAL_COVERAGE_STATES,
  hasValidInterviewWaitingInvariant,
  isAssessmentInterviewOutcome,
  type AssessmentInterviewAuditRef,
  type AssessmentInterviewBlockedAction,
  type AssessmentInterviewQuestion,
  type AssessmentInterviewRuntimeState,
  type AssessmentPostFindingRuntimeState,
} from "@lcsp/contracts/evidence";
import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";
import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";

import {
  ASSESSMENT_ARTIFACT_AVAILABILITIES,
  ASSESSMENT_RUNTIME_AVAILABILITIES,
  ASSESSMENT_SIDEBAR_WORKFLOW_STAGES,
  NORMALIZED_REPOSITORY_SOURCE_STATES,
  NORMALIZED_WORKFLOW_STEP_STATUSES,
  type AdapterInterviewStateInput,
  type AdapterTimelineInput,
  type AssessmentArtifactAvailability,
  type AssessmentRuntimeAvailability,
  type NormalizedAssessmentArtifactItem,
  type NormalizedAssessmentArtifacts,
  type NormalizedAssessmentCoverage,
  type NormalizedAssessmentIdentity,
  type NormalizedAssessmentIntegration,
  type NormalizedAssessmentInterview,
  type NormalizedAssessmentPostFinding,
  type NormalizedAssessmentRuntime,
  type NormalizedAssessmentRepository,
  type NormalizedWorkflowStep,
  type NormalizedAssessmentWorkflow,
  type NormalizedCustomerActions,
  type NormalizeAssessmentRuntimeParams,
} from "../types/assessment-runtime-adapter.types";
import {
  RUNTIME_THINKING_PHASES,
  WORKSPACE_RUNTIME_CONNECTION_STATES,
  type WorkspaceRuntimeConnectionState,
  type WorkspaceRuntimeRun,
  type WorkspaceRuntimeActivityItem,
  type WorkspaceRuntimeScanJob,
} from "../types/workspace-runtime.types";
import { sanitizeAssessmentInterviewState } from "../../../lib/api/assessment-interview-client";
import {
  ARTIFACT_STATUSES,
  ARTIFACT_TYPES,
} from "../../artifacts/types/artifact.types";
import { stageLabel } from "./assessment-runtime-formatter";
import { runtimeActivityDisplaySummary } from "./runtime-activity-summary";
import {
  formatRuntimeThinkingItem,
  projectRuntimeThinking,
  runtimeThinkingPhase,
} from "./runtime-thinking-projection";
import {
  ENGINEERING_RULE_ACTIVITY_TOOL_PREFIXES,
  ENGINEERING_RULE_GATE_TOOL_NAME,
} from "../config/runtime-activity";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import { appLocale } from "../../../lib/locale";

const APPROVED_BLOCKED_ACTIONS = new Set<AssessmentInterviewBlockedAction>([
  ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.provideMoreContext,
  ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.checkInternally,
  ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.saveAndExit,
]);

export function normalizeAssessmentRuntime(
  params: NormalizeAssessmentRuntimeParams,
): NormalizedAssessmentRuntime {
  const {
    assessmentId,
    interviewState: rawInterviewInput,
    artifactState,
    timeline: rawTimeline,
    coverageOverride,
  } = params;

  // 1. Unwrap interview query/data state
  const { interviewData, isLoadingInterview, isInterviewError, dataUpdatedAt } =
    extractInterviewInput(rawInterviewInput);

  const connectionState: WorkspaceRuntimeConnectionState =
    rawTimeline?.connectionState ??
    WORKSPACE_RUNTIME_CONNECTION_STATES.connected;

  const contractErrors: string[] = [];
  const missingFields: string[] = [];

  // 2. Validate and sanitize interview state
  let sanitizedInterview: AssessmentInterviewRuntimeState | null = null;
  if (interviewData !== null && interviewData !== undefined) {
    sanitizedInterview = sanitizeAssessmentInterviewState(interviewData);
    if (!sanitizedInterview) {
      contractErrors.push("Invalid interview state contract structure");
    }
  }

  // Check question-outcome invariant
  if (sanitizedInterview) {
    const isValidInvariant =
      hasValidInterviewWaitingInvariant(sanitizedInterview);
    if (!isValidInvariant) {
      contractErrors.push(
        `Invalid interview invariant: activeQuestion present but outcome is ${sanitizedInterview.outcome}`,
      );
    }
  }

  // 3. Identity normalization
  const audit: AssessmentInterviewAuditRef | null =
    sanitizedInterview?.audit ?? null;
  const identity: NormalizedAssessmentIdentity = {
    assessmentId,
    threadId: sanitizedInterview?.threadId ?? null,
    authenticatedActorId: audit?.authenticatedActorId ?? null,
    audit,
    contextRevision:
      sanitizedInterview?.contextRevision ?? audit?.contextRevision ?? null,
    priorRevision: audit?.priorRevision ?? null,
    newRevision: audit?.newRevision ?? null,
  };

  const repository: NormalizedAssessmentRepository = normalizeRepository(
    rawTimeline?.repositorySnapshot,
  );

  // 4. Coverage normalization
  const coverage = normalizeCoverage({
    coverageOverride,
    timeline: rawTimeline,
    audit,
    missingFields,
  });

  // 5. Workflow normalization
  const workflow = normalizeWorkflow({
    timeline: rawTimeline,
    sanitizedInterview,
    repositorySnapshot: rawTimeline?.repositorySnapshot,
    latestScanJob: latestSnapshotScanJob(
      assessmentId,
      rawTimeline?.repositorySnapshot,
      rawTimeline?.scanJobs ?? [],
    ),
  });

  // 6. Interview normalization
  const interview = normalizeInterview({
    sanitizedInterview,
    isLoadingInterview,
    contractErrors,
    dataUpdatedAt,
  });

  const postFinding = normalizePostFinding({
    assessmentId,
    postFinding: rawTimeline?.postFinding ?? null,
    contractErrors,
  });

  // 7. Artifacts normalization
  const artifacts = normalizeArtifacts({
    assessmentId,
    workflow,
    interview,
    repositorySnapshot: rawTimeline?.repositorySnapshot ?? null,
    scanJobs: rawTimeline?.scanJobs ?? [],
    evidenceReports: rawTimeline?.evidenceReports ?? [],
    postFinding,
    artifactState,
  });

  // 8. Customer Actions normalization
  const customerActions = normalizeCustomerActions({
    interview,
    coverage,
    contractErrors,
    isLoadingInterview,
    postFinding,
  });

  // 9. Derive authoritative presentation availability
  let availability: AssessmentRuntimeAvailability =
    ASSESSMENT_RUNTIME_AVAILABILITIES.ready;
  if (contractErrors.length > 0) {
    availability = ASSESSMENT_RUNTIME_AVAILABILITIES.invalid;
  } else if (isLoadingInterview) {
    availability = ASSESSMENT_RUNTIME_AVAILABILITIES.loading;
  } else if (
    connectionState === WORKSPACE_RUNTIME_CONNECTION_STATES.disconnected
  ) {
    availability = ASSESSMENT_RUNTIME_AVAILABILITIES.disconnected;
  } else if (isInterviewError) {
    availability = ASSESSMENT_RUNTIME_AVAILABILITIES.unavailable;
  } else if (
    coverage.state === ASSESSMENT_TECHNICAL_COVERAGE_STATES.unavailable
  ) {
    availability = ASSESSMENT_RUNTIME_AVAILABILITIES.unavailable;
  }

  const integration: NormalizedAssessmentIntegration = {
    missingFields,
    contractErrors,
    isContractValid: contractErrors.length === 0,
  };

  return {
    availability,
    connectionState,
    identity,
    repository,
    coverage,
    workflow,
    interview,
    postFinding,
    artifacts,
    customerActions,
    integration,
  };
}

function normalizePostFinding({
  assessmentId,
  postFinding,
  contractErrors,
}: {
  assessmentId: string;
  postFinding: AssessmentPostFindingRuntimeState | null;
  contractErrors: string[];
}): NormalizedAssessmentPostFinding | null {
  if (postFinding === null) {
    return null;
  }

  if (postFinding.assessmentId !== assessmentId) {
    contractErrors.push("Post-finding runtime belongs to another assessment");
    return null;
  }

  return {
    phase: postFinding.phase,
    codeReviewActivities: postFinding.codeReviewActivities,
    availableDecisions: postFinding.decisionAvailability,
    selectedDecision: postFinding.selectedDecision ?? null,
    selectedDecisionAt: postFinding.selectedDecisionAt ?? null,
    detectedPullRequest: postFinding.detectedPullRequest ?? null,
    createdPullRequest: postFinding.createdPullRequest ?? null,
    approvalStatus: postFinding.approvalStatus,
    approvedPatchVersion: postFinding.approvedPatchVersion ?? null,
    verificationActivities: postFinding.verificationActivities,
    verificationStatus: postFinding.verificationStatus ?? null,
    finalResult: postFinding.finalResult ?? null,
    canContinueRemediation: postFinding.canContinueRemediation === true,
    artifacts: postFinding.artifacts ?? {},
  };
}

function extractInterviewInput(input: unknown) {
  if (!input || typeof input !== "object") {
    return {
      interviewData: null,
      isLoadingInterview: false,
      isInterviewError: false,
      dataUpdatedAt: undefined,
    };
  }

  const queryLike = input as AdapterInterviewStateInput;
  if (
    "data" in queryLike ||
    "isLoading" in queryLike ||
    "isError" in queryLike
  ) {
    return {
      interviewData: queryLike.data ?? null,
      isLoadingInterview: Boolean(queryLike.isLoading),
      isInterviewError: Boolean(queryLike.isError),
      dataUpdatedAt: queryLike.dataUpdatedAt,
    };
  }

  return {
    interviewData: input,
    isLoadingInterview: false,
    isInterviewError: false,
    dataUpdatedAt: undefined,
  };
}

function normalizeCoverage({
  coverageOverride,
  timeline,
  audit,
  missingFields,
}: {
  coverageOverride?: NormalizeAssessmentRuntimeParams["coverageOverride"];
  timeline?: AdapterTimelineInput | null;
  audit: AssessmentInterviewAuditRef | null;
  missingFields: string[];
}): NormalizedAssessmentCoverage {
  if (coverageOverride?.state) {
    return {
      state: coverageOverride.state,
      limitations: coverageOverride.limitations ?? [],
      policyDecision: coverageOverride.policyDecision ?? null,
      recovery: {
        isUnavailable:
          coverageOverride.state ===
          ASSESSMENT_TECHNICAL_COVERAGE_STATES.unavailable,
        reason: coverageOverride.recoveryReason ?? null,
      },
    };
  }

  // When LCSP-292 policy information is not provided by runtime:
  if (audit?.pgeVersion) {
    return {
      state: ASSESSMENT_TECHNICAL_COVERAGE_STATES.ready,
      limitations: [],
      policyDecision: null,
      recovery: { isUnavailable: false, reason: null },
    };
  }

  // Check timeline scan state
  const currentRun = timeline?.currentRun;
  if (currentRun?.stage === ASSESSMENT_RUNTIME_STAGE_CODES.scan) {
    if (currentRun.status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed) {
      return {
        state: ASSESSMENT_TECHNICAL_COVERAGE_STATES.unavailable,
        limitations: ["Repository scan failed"],
        policyDecision: null,
        recovery: { isUnavailable: true, reason: "Scanner execution failure" },
      };
    }
  }

  // Document missing LCSP-292 partial coverage policy contract field when unavailable
  missingFields.push("coverage.policyDecision");

  return {
    state: ASSESSMENT_TECHNICAL_COVERAGE_STATES.ready,
    limitations: [],
    policyDecision: null,
    recovery: { isUnavailable: false, reason: null },
  };
}

function normalizeWorkflow({
  timeline,
  sanitizedInterview,
  repositorySnapshot,
  latestScanJob,
}: {
  timeline?: AdapterTimelineInput | null;
  sanitizedInterview: AssessmentInterviewRuntimeState | null;
  repositorySnapshot: AdapterTimelineInput["repositorySnapshot"];
  latestScanJob: WorkspaceRuntimeScanJob | null;
}): NormalizedAssessmentWorkflow {
  const currentRun = timeline?.currentRun ?? null;
  const latestRunId = timeline?.latestRunId ?? currentRun?.runId ?? null;
  const recentActivity = scopeRuntimeActivity(
    timeline?.recentActivity ?? [],
    latestRunId,
  );
  const engineeringProgress = scopeEngineeringProgress(
    timeline?.engineeringProgress ?? [],
    latestRunId,
  );

  // Targeted clarification loop detection:
  // e.g. Investigator paused / waiting for business context + Interview active/clarifying
  const hasInvestigatorWaiting = recentActivity.some(
    (item) =>
      item.stage === "INVESTIGATE" ||
      item.stage === "investigate" ||
      item.stage === ASSESSMENT_RUNTIME_STAGE_CODES.classification ||
      item.waitingReason?.includes("context") ||
      item.waitingReason?.includes("interview"),
  );

  const isClarifyingQuestion =
    sanitizedInterview?.activeQuestion?.intent ===
    ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify;

  const isTargetedClarificationLoop =
    (hasInvestigatorWaiting && isClarifyingQuestion) ||
    (sanitizedInterview?.outcome ===
      ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved &&
      Boolean(
        sanitizedInterview.flags?.includes(
          ASSESSMENT_INTERVIEW_FLAGS.downstreamImpact,
        ),
      ));

  return {
    stage: currentRun?.stage ?? recentActivity[0]?.stage ?? null,
    status: currentRun?.status ?? recentActivity[0]?.runStatus ?? null,
    currentRunId: latestRunId,
    activeTools: currentRun?.activeTools ?? [],
    recentActivity,
    engineeringProgress,
    lastEmittedAt:
      timeline?.lastEmittedAt ?? recentActivity[0]?.emittedAt ?? null,
    isTargetedClarificationLoop,
    latestRun: currentRun,
    steps: normalizeWorkflowSteps({
      currentRun,
      recentActivity,
      engineeringProgress,
      repositorySnapshot,
      sanitizedInterview,
      latestScanJob,
    }),
  };
}

function scopeRuntimeActivity(
  recentActivity: WorkspaceRuntimeActivityItem[],
  latestRunId: string | null,
): WorkspaceRuntimeActivityItem[] {
  if (!latestRunId) {
    return recentActivity;
  }

  return recentActivity.filter((item) => item.runId === latestRunId);
}

function scopeEngineeringProgress(
  progress: NonNullable<AdapterTimelineInput["engineeringProgress"]>,
  latestRunId: string | null,
): NonNullable<AdapterTimelineInput["engineeringProgress"]> {
  if (!latestRunId) {
    return progress;
  }

  return progress.filter((item) => item.runId === latestRunId);
}

function normalizeRepository(
  snapshot: AdapterTimelineInput["repositorySnapshot"],
): NormalizedAssessmentRepository {
  if (!snapshot) {
    return {
      provider: null,
      repositoryFullName: null,
      branch: null,
      pinnedCommit: null,
      sourceState: NORMALIZED_REPOSITORY_SOURCE_STATES.pending,
    };
  }
  return {
    provider: snapshot.provider,
    repositoryFullName: snapshot.repositoryFullName,
    branch: snapshot.branch,
    pinnedCommit: snapshot.commitSha,
    sourceState: NORMALIZED_REPOSITORY_SOURCE_STATES.available,
  };
}

function normalizeWorkflowSteps({
  currentRun,
  recentActivity,
  engineeringProgress,
  repositorySnapshot,
  sanitizedInterview,
  latestScanJob,
}: {
  currentRun: WorkspaceRuntimeRun | null;
  recentActivity: WorkspaceRuntimeActivityItem[];
  engineeringProgress: NonNullable<AdapterTimelineInput["engineeringProgress"]>;
  repositorySnapshot: AdapterTimelineInput["repositorySnapshot"];
  sanitizedInterview: AssessmentInterviewRuntimeState | null;
  latestScanJob: WorkspaceRuntimeScanJob | null;
}): NormalizedWorkflowStep[] {
  const defaultSteps = [
    [
      ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.repository,
      "pages.appShell.runtimePanelRepository",
    ],
    [
      ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.scanner,
      "pages.appShell.assessmentSidebar.workflow.scanner",
    ],
    [
      ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.interview,
      "pages.appShell.assessmentSidebar.workflow.interview",
    ],
    [
      ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.rules,
      "pages.appShell.assessmentSidebar.workflow.rules",
    ],
    [
      ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.planner,
      "pages.appShell.assessmentSidebar.workflow.planner",
    ],
    [
      ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.investigate,
      "pages.appShell.assessmentSidebar.workflow.investigate",
    ],
    [
      ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.gate,
      "pages.appShell.assessmentSidebar.workflow.gate",
    ],
  ] as const;
  const steps = new Map<string, NormalizedWorkflowStep>([
    ...defaultSteps.map(
      ([id, labelKey]) =>
        [
          id,
          {
            id,
            label: resolveMessage(appLocale, labelKey as MessageKey),
            status:
              id === ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.repository &&
              repositorySnapshot
                ? NORMALIZED_WORKFLOW_STEP_STATUSES.completed
                : NORMALIZED_WORKFLOW_STEP_STATUSES.queued,
            detail: null,
          } satisfies NormalizedWorkflowStep,
        ] as const,
    ),
  ]);
  for (const activity of [...recentActivity].reverse()) {
    const id = workflowStepIdForRuntimeActivity(activity);
    steps.set(id, {
      id,
      label: steps.has(id) ? steps.get(id)!.label : stageLabel(activity.stage),
      status: normalizeActivityStepStatus(activity),
      // Per-rule Planner/Investigator lines carry internal rule IDs and reason codes;
      // those steps get an aggregated detail below instead.
      detail:
        activity.summary && !runtimeThinkingPhase(activity)
          ? runtimeActivityDisplaySummary(activity)
          : null,
    });
  }
  applyEngineeringRuleStepDetails(steps, recentActivity, engineeringProgress);
  if (currentRun) {
    const id = workflowStepIdForRun(currentRun);
    steps.set(id, {
      id,
      label: steps.has(id)
        ? steps.get(id)!.label
        : stageLabel(currentRun.stage),
      status: normalizeStepStatus(currentRun.status),
      detail: null,
    });
  }
  const interviewStepStatus = normalizeInterviewStepStatus(sanitizedInterview);
  if (interviewStepStatus) {
    const id = ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.interview;
    const existingStep = steps.get(id);
    steps.set(id, {
      id,
      label: existingStep?.label ?? stageLabel(id),
      status: interviewStepStatus,
      detail: existingStep?.detail ?? null,
    });
  }
  applyLegacyClassificationGateProjection({
    steps,
    currentRun,
    recentActivity,
  });
  // A rerun creates the scan job before the worker emits any runtime event, so
  // the previous run's events would still decide this row. Follow the scan job
  // the same way the scanner checklist does.
  if (latestScanJob && isActiveScanJob(latestScanJob)) {
    const id = ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.scanner;
    const existingStep = steps.get(id);
    steps.set(id, {
      id,
      label: existingStep?.label ?? stageLabel(id),
      status: NORMALIZED_WORKFLOW_STEP_STATUSES.running,
      detail: existingStep?.detail ?? null,
    });
  }
  completeQueuedPredecessors(steps);
  return [...steps.values()];
}

function applyEngineeringRuleStepDetails(
  steps: Map<string, NormalizedWorkflowStep>,
  recentActivity: WorkspaceRuntimeActivityItem[],
  engineeringProgress: NonNullable<AdapterTimelineInput["engineeringProgress"]>,
): void {
  const items = projectRuntimeThinking(recentActivity, engineeringProgress);
  for (const [stepId, phase] of [
    [
      ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.planner,
      RUNTIME_THINKING_PHASES.planner,
    ],
    [
      ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.investigate,
      RUNTIME_THINKING_PHASES.investigator,
    ],
  ] as const) {
    const step = steps.get(stepId);
    const detail = items
      .filter((item) => item.phase === phase)
      .map(formatRuntimeThinkingItem)
      .join(" ");
    if (step && detail) {
      steps.set(stepId, { ...step, detail });
    }
  }
}

const TERMINAL_WORKFLOW_STEP_STATUSES = new Set<
  NormalizedWorkflowStep["status"]
>([
  NORMALIZED_WORKFLOW_STEP_STATUSES.completed,
  NORMALIZED_WORKFLOW_STEP_STATUSES.skipped,
  NORMALIZED_WORKFLOW_STEP_STATUSES.failed,
]);

/**
 * Compatibility fallback for historical runs recorded before the API emitted an
 * explicit terminal Gate event. New runs carry `engineering_rule_gate` COMPLETED or
 * SKIPPED/NOT_REQUIRED in the Classification run, which always wins over this.
 * It also enforces the scope invariant: a non-terminal Gate never coexists with a
 * completed Classification in the same execution scope.
 */
function applyLegacyClassificationGateProjection({
  steps,
  currentRun,
  recentActivity,
}: {
  steps: Map<string, NormalizedWorkflowStep>;
  currentRun: WorkspaceRuntimeRun | null;
  recentActivity: WorkspaceRuntimeActivityItem[];
}): void {
  const gateStep = steps.get(ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.gate);
  if (
    !gateStep ||
    TERMINAL_WORKFLOW_STEP_STATUSES.has(gateStep.status) ||
    hasExplicitTerminalGateEvent(recentActivity) ||
    !hasCompletedClassificationRuntime(currentRun, recentActivity)
  ) {
    return;
  }

  steps.set(ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.gate, {
    ...gateStep,
    status: NORMALIZED_WORKFLOW_STEP_STATUSES.skipped,
  });
}

function hasExplicitTerminalGateEvent(
  recentActivity: WorkspaceRuntimeActivityItem[],
): boolean {
  return recentActivity.some(
    (activity) =>
      activity.toolName === ENGINEERING_RULE_GATE_TOOL_NAME &&
      (activity.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted ||
        activity.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolSkipped ||
        activity.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolFailed),
  );
}

function hasCompletedClassificationRuntime(
  currentRun: WorkspaceRuntimeRun | null,
  recentActivity: WorkspaceRuntimeActivityItem[],
): boolean {
  if (
    currentRun?.stage === ASSESSMENT_RUNTIME_STAGE_CODES.classification &&
    currentRun.status === ASSESSMENT_RUNTIME_RUN_STATUSES.completed
  ) {
    return true;
  }

  return recentActivity.some(
    (activity) =>
      activity.stage === ASSESSMENT_RUNTIME_STAGE_CODES.classification &&
      (activity.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.runCompleted ||
        activity.runStatus === ASSESSMENT_RUNTIME_RUN_STATUSES.completed),
  );
}

function normalizeInterviewStepStatus(
  sanitizedInterview: AssessmentInterviewRuntimeState | null,
): NormalizedWorkflowStep["status"] | null {
  if (!sanitizedInterview) {
    return null;
  }

  switch (sanitizedInterview.outcome) {
    case ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer:
      return sanitizedInterview.activeQuestion
        ? NORMALIZED_WORKFLOW_STEP_STATUSES.running
        : NORMALIZED_WORKFLOW_STEP_STATUSES.waiting;
    case ASSESSMENT_INTERVIEW_OUTCOMES.contextReady:
    case ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved:
      return NORMALIZED_WORKFLOW_STEP_STATUSES.completed;
    case ASSESSMENT_INTERVIEW_OUTCOMES.failed:
      return NORMALIZED_WORKFLOW_STEP_STATUSES.failed;
    case ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved:
      return NORMALIZED_WORKFLOW_STEP_STATUSES.waiting;
    default:
      return null;
  }
}

function workflowStepIdForRun(run: WorkspaceRuntimeRun): string {
  const activeToolName =
    run.activeTools.find((tool) =>
      tool.toolName.startsWith(
        ENGINEERING_RULE_ACTIVITY_TOOL_PREFIXES.investigator,
      ),
    )?.toolName ??
    run.activeTools.find((tool) =>
      tool.toolName.startsWith(ENGINEERING_RULE_ACTIVITY_TOOL_PREFIXES.planner),
    )?.toolName ??
    null;
  return workflowStepIdForStage(run.stage, activeToolName);
}

function workflowStepIdForRuntimeActivity(
  activity: WorkspaceRuntimeActivityItem,
): string {
  return workflowStepIdForStage(activity.stage, activity.toolName);
}

function workflowStepIdForStage(
  stage: string,
  toolName: string | null,
): string {
  if (toolName === ENGINEERING_RULE_GATE_TOOL_NAME) {
    return ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.gate;
  }
  if (stage === ASSESSMENT_RUNTIME_STAGE_CODES.snapshot) {
    return ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.repository;
  }
  if (stage === ASSESSMENT_RUNTIME_STAGE_CODES.scan) {
    return ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.scanner;
  }
  if (stage === ASSESSMENT_RUNTIME_STAGE_CODES.interview) {
    return ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.interview;
  }
  if (stage !== ASSESSMENT_RUNTIME_STAGE_CODES.technicalEvidence) {
    return stage;
  }
  if (
    toolName?.startsWith(ENGINEERING_RULE_ACTIVITY_TOOL_PREFIXES.investigator)
  ) {
    return ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.investigate;
  }
  if (toolName?.startsWith(ENGINEERING_RULE_ACTIVITY_TOOL_PREFIXES.planner)) {
    return ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.planner;
  }
  return ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.rules;
}

function normalizeActivityStepStatus(
  activity: WorkspaceRuntimeActivityItem,
): NormalizedWorkflowStep["status"] {
  // Only the Gate treats TOOL_SKIPPED as a terminal SKIPPED step. Planner rule-level
  // SKIP decisions are progress inside a completed Planner step.
  if (
    activity.toolName === ENGINEERING_RULE_GATE_TOOL_NAME &&
    activity.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolSkipped
  ) {
    return NORMALIZED_WORKFLOW_STEP_STATUSES.skipped;
  }
  if (
    activity.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted ||
    activity.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolSkipped ||
    activity.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.runCompleted
  ) {
    return NORMALIZED_WORKFLOW_STEP_STATUSES.completed;
  }
  if (
    activity.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolFailed ||
    activity.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.runFailed
  ) {
    return NORMALIZED_WORKFLOW_STEP_STATUSES.failed;
  }
  return normalizeStepStatus(activity.runStatus);
}

function completeQueuedPredecessors(
  steps: Map<string, NormalizedWorkflowStep>,
): void {
  const orderedStages = [
    ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.repository,
    ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.scanner,
    ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.interview,
    ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.rules,
    ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.planner,
    ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.investigate,
    ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.gate,
  ] as const;
  const lastActiveIndex = orderedStages.reduce((lastIndex, stage, index) => {
    const status = steps.get(stage)?.status;
    return status && status !== NORMALIZED_WORKFLOW_STEP_STATUSES.queued
      ? index
      : lastIndex;
  }, -1);

  for (const stage of orderedStages.slice(0, lastActiveIndex)) {
    const step = steps.get(stage);
    if (!step || step.status !== NORMALIZED_WORKFLOW_STEP_STATUSES.queued) {
      continue;
    }
    steps.set(stage, {
      ...step,
      status: NORMALIZED_WORKFLOW_STEP_STATUSES.completed,
    });
  }
}

function normalizeStepStatus(status: string) {
  switch (status) {
    case ASSESSMENT_RUNTIME_RUN_STATUSES.running:
      return NORMALIZED_WORKFLOW_STEP_STATUSES.running;
    case ASSESSMENT_RUNTIME_RUN_STATUSES.waiting:
      return NORMALIZED_WORKFLOW_STEP_STATUSES.waiting;
    case ASSESSMENT_RUNTIME_RUN_STATUSES.completed:
      return NORMALIZED_WORKFLOW_STEP_STATUSES.completed;
    case ASSESSMENT_RUNTIME_RUN_STATUSES.failed:
      return NORMALIZED_WORKFLOW_STEP_STATUSES.failed;
    default:
      return NORMALIZED_WORKFLOW_STEP_STATUSES.unknown;
  }
}

function normalizeInterview({
  sanitizedInterview,
  isLoadingInterview,
  contractErrors,
  dataUpdatedAt,
}: {
  sanitizedInterview: AssessmentInterviewRuntimeState | null;
  isLoadingInterview: boolean;
  contractErrors: string[];
  dataUpdatedAt?: number;
}): NormalizedAssessmentInterview {
  if (!sanitizedInterview) {
    return {
      outcome: null,
      activeQuestion: null,
      assistantMessage: null,
      flags: [],
      hasDownstreamImpact: false,
      contextAuthority: null,
      blockedActions: [],
      answerHistory: [],
      pendingDraft: null,
      orchestrationRequested: false,
      stale: false,
      revalidating: isLoadingInterview && Boolean(dataUpdatedAt),
    };
  }

  const outcome = sanitizedInterview.outcome;
  const isValidOutcome = isAssessmentInterviewOutcome(outcome);
  if (!isValidOutcome) {
    contractErrors.push(`Unknown interview outcome: ${String(outcome)}`);
  }

  const flags = sanitizedInterview.flags ?? [];
  const hasDownstreamImpact = flags.includes(
    ASSESSMENT_INTERVIEW_FLAGS.downstreamImpact,
  );

  // Filter blockedActions to only approved semantic actions when outcome is BLOCKED_OR_UNRESOLVED
  let blockedActions: AssessmentInterviewBlockedAction[] = [];
  if (outcome === ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved) {
    if (sanitizedInterview.blockedActions) {
      blockedActions = sanitizedInterview.blockedActions.filter((action) =>
        APPROVED_BLOCKED_ACTIONS.has(action),
      );
    } else {
      // Default approved actions for BLOCKED_OR_UNRESOLVED if none provided
      blockedActions = [
        ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.provideMoreContext,
        ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.checkInternally,
        ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.saveAndExit,
      ];
    }
  }

  // Active question normalization
  let activeQuestion: AssessmentInterviewQuestion | null = null;
  if (
    outcome === ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer &&
    sanitizedInterview.activeQuestion
  ) {
    activeQuestion = sanitizedInterview.activeQuestion;
  }

  return {
    outcome: isValidOutcome ? outcome : null,
    activeQuestion,
    assistantMessage: sanitizedInterview.assistantMessage ?? null,
    flags,
    hasDownstreamImpact,
    contextAuthority: sanitizedInterview.contextAuthority ?? null,
    blockedActions,
    answerHistory: sanitizedInterview.answerHistory ?? [],
    pendingDraft: sanitizedInterview.pendingDraft ?? null,
    orchestrationRequested: Boolean(sanitizedInterview.orchestrationRequested),
    stale:
      sanitizedInterview.contextAuthority ===
      ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.superseded,
    revalidating: false,
  };
}

/** Latest scan job for the assessment's pinned repository snapshot. */
function latestSnapshotScanJob(
  assessmentId: string,
  repositorySnapshot: AdapterTimelineInput["repositorySnapshot"],
  scanJobs: NonNullable<AdapterTimelineInput["scanJobs"]>,
): WorkspaceRuntimeScanJob | null {
  if (!repositorySnapshot || repositorySnapshot.assessmentId !== assessmentId) {
    return null;
  }
  return (
    scanJobs
      .filter(
        (job) =>
          job.assessmentId === repositorySnapshot.assessmentId &&
          job.snapshotId === repositorySnapshot.id,
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
  );
}

/** Mirrors the scanner checklist: any scan job that has not ended is running. */
function isActiveScanJob(job: WorkspaceRuntimeScanJob): boolean {
  return (
    job.status !== REPOSITORY_SCAN_JOB_STATUSES.completed &&
    job.status !== REPOSITORY_SCAN_JOB_STATUSES.failed &&
    job.status !== REPOSITORY_SCAN_JOB_STATUSES.blocked &&
    job.status !== REPOSITORY_SCAN_JOB_STATUSES.blockedMapping
  );
}

function normalizeProgramEvidenceAvailability({
  assessmentId,
  repositorySnapshot,
  scanJobs,
  evidenceReports,
}: {
  assessmentId: string;
  repositorySnapshot: AdapterTimelineInput["repositorySnapshot"];
  scanJobs: NonNullable<AdapterTimelineInput["scanJobs"]>;
  evidenceReports: NonNullable<AdapterTimelineInput["evidenceReports"]>;
}): AssessmentArtifactAvailability {
  if (!repositorySnapshot || repositorySnapshot.assessmentId !== assessmentId) {
    return ASSESSMENT_ARTIFACT_AVAILABILITIES.unavailable;
  }

  const latestJob = latestSnapshotScanJob(
    assessmentId,
    repositorySnapshot,
    scanJobs,
  );

  if (!latestJob) {
    return ASSESSMENT_ARTIFACT_AVAILABILITIES.waiting;
  }

  switch (latestJob.status) {
    case REPOSITORY_SCAN_JOB_STATUSES.queued:
    case REPOSITORY_SCAN_JOB_STATUSES.running:
      return ASSESSMENT_ARTIFACT_AVAILABILITIES.updating;
    case REPOSITORY_SCAN_JOB_STATUSES.pendingMapping:
    case REPOSITORY_SCAN_JOB_STATUSES.waitingForContext:
    case REPOSITORY_SCAN_JOB_STATUSES.readyToSnapshot:
      return ASSESSMENT_ARTIFACT_AVAILABILITIES.waiting;
    case REPOSITORY_SCAN_JOB_STATUSES.failed:
    case REPOSITORY_SCAN_JOB_STATUSES.blocked:
    case REPOSITORY_SCAN_JOB_STATUSES.blockedMapping:
      return ASSESSMENT_ARTIFACT_AVAILABILITIES.unavailable;
    case REPOSITORY_SCAN_JOB_STATUSES.completed:
      break;
    default:
      return ASSESSMENT_ARTIFACT_AVAILABILITIES.waiting;
  }

  const latestReport = evidenceReports
    .filter(
      (report) =>
        report.assessmentId === repositorySnapshot.assessmentId &&
        report.snapshotId === repositorySnapshot.id &&
        report.scanJobId === latestJob.id,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  if (!latestReport) {
    return ASSESSMENT_ARTIFACT_AVAILABILITIES.waiting;
  }

  if (latestReport.status === TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted) {
    return ASSESSMENT_ARTIFACT_AVAILABILITIES.ready;
  }

  if (latestReport.status === TECHNICAL_EVIDENCE_REPORT_STATUSES.rejected) {
    return ASSESSMENT_ARTIFACT_AVAILABILITIES.unavailable;
  }

  return ASSESSMENT_ARTIFACT_AVAILABILITIES.waiting;
}

function normalizeArtifacts({
  assessmentId,
  postFinding,
  repositorySnapshot,
  scanJobs,
  evidenceReports,
  artifactState,
}: {
  assessmentId: string;
  workflow: NormalizedAssessmentWorkflow;
  interview: NormalizedAssessmentInterview;
  postFinding: NormalizedAssessmentPostFinding | null;
  repositorySnapshot: AdapterTimelineInput["repositorySnapshot"];
  scanJobs: NonNullable<AdapterTimelineInput["scanJobs"]>;
  evidenceReports: NonNullable<AdapterTimelineInput["evidenceReports"]>;
  artifactState: NormalizeAssessmentRuntimeParams["artifactState"];
}): NormalizedAssessmentArtifacts {
  const pegAvailability = normalizeProgramEvidenceAvailability({
    assessmentId,
    repositorySnapshot,
    scanJobs,
    evidenceReports,
  });

  const programEvidenceGraph: NormalizedAssessmentArtifactItem = {
    ref: { assessmentId, type: ARTIFACT_TYPES.programEvidenceGraph },
    type: ARTIFACT_TYPES.programEvidenceGraph,
    status: availabilityToArtifactStatus(pegAvailability),
    category: "TECHNICAL_EVIDENCE",
    id: "program-evidence-graph",
    kind: "PROGRAM_EVIDENCE_GRAPH",
    labelKey: "artifacts.types.programEvidenceGraph",
    availability: pegAvailability,
    customerSafeSummary:
      pegAvailability === ASSESSMENT_ARTIFACT_AVAILABILITIES.ready
        ? "Program evidence graph verified"
        : null,
  };

  const businessContextAvailability = apiArtifactAvailability(
    artifactState?.data?.businessContext.status,
    artifactState,
  );
  const businessContext: NormalizedAssessmentArtifactItem = {
    ref: { assessmentId, type: ARTIFACT_TYPES.businessContext },
    type: ARTIFACT_TYPES.businessContext,
    status: availabilityToArtifactStatus(businessContextAvailability),
    category: "WORKING_RESULT",
    id: "business-context",
    kind: "BUSINESS_CONTEXT",
    labelKey: "artifacts.types.businessContext",
    availability: businessContextAvailability,
    customerSafeSummary: null,
  };

  const notesAvailability = apiArtifactAvailability(
    artifactState?.data?.investigationNotes.status,
    artifactState,
  );
  const investigationNotes: NormalizedAssessmentArtifactItem = {
    ref: { assessmentId, type: ARTIFACT_TYPES.investigationNotes },
    type: ARTIFACT_TYPES.investigationNotes,
    status: availabilityToArtifactStatus(notesAvailability),
    category: "WORKING_RESULT",
    id: "investigation-notes",
    kind: "INVESTIGATION_NOTES",
    labelKey: "artifacts.types.investigationNotes",
    availability: notesAvailability,
    customerSafeSummary: null,
  };

  const remediationPatch = normalizePostFindingArtifact({
    assessmentId,
    resourceId: postFinding?.artifacts.remediationPatchResourceId,
    type: ARTIFACT_TYPES.remediationPatch,
    labelKey: "artifacts.types.remediationPatch",
  });
  const verificationReport = normalizePostFindingArtifact({
    assessmentId,
    resourceId: postFinding?.artifacts.verificationReportResourceId,
    type: ARTIFACT_TYPES.verificationReport,
    labelKey: "artifacts.types.verificationReport",
  });
  const finalReport = normalizePostFindingArtifact({
    assessmentId,
    resourceId: postFinding?.artifacts.finalReportResourceId,
    type: ARTIFACT_TYPES.finalReport,
    labelKey: "artifacts.types.finalReport",
  });

  const items: NormalizedAssessmentArtifactItem[] = [
    programEvidenceGraph,
    businessContext,
    investigationNotes,
    ...[remediationPatch, verificationReport, finalReport].filter(
      (artifact): artifact is NormalizedAssessmentArtifactItem => artifact !== null,
    ),
  ];

  return {
    items,
    programEvidenceGraph,
    businessContext,
    investigationNotes,
    remediationPatch,
    verificationReport,
    finalReport,
  };
}

function apiArtifactAvailability(
  status: string | undefined,
  query: NormalizeAssessmentRuntimeParams["artifactState"],
): AssessmentArtifactAvailability {
  if (query?.isLoading && !query.data) {
    return ASSESSMENT_ARTIFACT_AVAILABILITIES.waiting;
  }
  switch (status) {
    case ASSESSMENT_ARTIFACT_STATUSES.ready:
      return ASSESSMENT_ARTIFACT_AVAILABILITIES.ready;
    case ASSESSMENT_ARTIFACT_STATUSES.pending:
      return ASSESSMENT_ARTIFACT_AVAILABILITIES.updating;
    case ASSESSMENT_ARTIFACT_STATUSES.failed:
    case ASSESSMENT_ARTIFACT_STATUSES.notAvailable:
      return ASSESSMENT_ARTIFACT_AVAILABILITIES.unavailable;
    default:
      return query?.isError
        ? ASSESSMENT_ARTIFACT_AVAILABILITIES.unavailable
        : ASSESSMENT_ARTIFACT_AVAILABILITIES.waiting;
  }
}

function normalizePostFindingArtifact({
  assessmentId,
  resourceId,
  type,
  labelKey,
}: {
  assessmentId: string;
  resourceId: string | undefined;
  type: NormalizedAssessmentArtifactItem["type"];
  labelKey: string;
}): NormalizedAssessmentArtifactItem | null {
  if (!resourceId) {
    return null;
  }

  return {
    ref: { assessmentId, type, resourceId },
    type,
    status: ARTIFACT_STATUSES.ready,
    category: "DURABLE_ARTIFACT",
    id: resourceId,
    kind: type,
    labelKey,
    availability: ASSESSMENT_ARTIFACT_AVAILABILITIES.ready,
    customerSafeSummary: null,
  };
}

function availabilityToArtifactStatus(
  availability: AssessmentArtifactAvailability,
) {
  switch (availability) {
    case ASSESSMENT_ARTIFACT_AVAILABILITIES.ready:
      return ARTIFACT_STATUSES.ready;
    case ASSESSMENT_ARTIFACT_AVAILABILITIES.waiting:
      return ARTIFACT_STATUSES.waiting;
    case ASSESSMENT_ARTIFACT_AVAILABILITIES.updating:
      return ARTIFACT_STATUSES.updating;
    case ASSESSMENT_ARTIFACT_AVAILABILITIES.paused:
      return ARTIFACT_STATUSES.paused;
    default:
      return ARTIFACT_STATUSES.unavailable;
  }
}

function normalizeCustomerActions({
  interview,
  coverage,
  contractErrors,
  isLoadingInterview,
  postFinding,
}: {
  interview: NormalizedAssessmentInterview;
  coverage: NormalizedAssessmentCoverage;
  contractErrors: string[];
  isLoadingInterview: boolean;
  postFinding: NormalizedAssessmentPostFinding | null;
}): NormalizedCustomerActions {
  if (contractErrors.length > 0 || isLoadingInterview) {
    return {
      canAnswerQuestion: false,
      canSubmitDraft: false,
      canSubmitBlockedAction: false,
      availableBlockedActions: [],
      canUseComposer: false,
      canSelectRemediationDecision: false,
      availableRemediationDecisions: [],
    };
  }

  // If coverage is UNAVAILABLE or coverage policy explicitly denies interview:
  if (
    coverage.state === ASSESSMENT_TECHNICAL_COVERAGE_STATES.unavailable ||
    (coverage.policyDecision && !coverage.policyDecision.permittedForInterview)
  ) {
    return {
      canAnswerQuestion: false,
      canSubmitDraft: false,
      canSubmitBlockedAction: false,
      availableBlockedActions: [],
      canUseComposer: false,
      canSelectRemediationDecision: false,
      availableRemediationDecisions: [],
    };
  }

  const isWaiting =
    interview.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer;
  const hasQuestion = Boolean(interview.activeQuestion);
  const isBlocked =
    interview.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved;

  const canAnswerQuestion = isWaiting && hasQuestion;
  const canSubmitDraft = canAnswerQuestion;
  const canSubmitBlockedAction =
    isBlocked && interview.blockedActions.length > 0;
  const canUseComposer = canAnswerQuestion;
  const canSelectRemediationDecision =
    postFinding !== null &&
    postFinding.selectedDecision === null &&
    postFinding.availableDecisions.length > 0;

  return {
    canAnswerQuestion,
    canSubmitDraft,
    canSubmitBlockedAction,
    availableBlockedActions: isBlocked ? interview.blockedActions : [],
    canUseComposer,
    canSelectRemediationDecision,
    availableRemediationDecisions: canSelectRemediationDecision
      ? postFinding.availableDecisions
      : [],
  };
}
