import {
  ASSESSMENT_CONTEXT_AUTHORITY_STATUSES,
  ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS,
  ASSESSMENT_INTERVIEW_FLAGS,
  ASSESSMENT_INTERVIEW_OUTCOMES,
  ASSESSMENT_INTERVIEW_QUESTION_INTENTS,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  ASSESSMENT_RUNTIME_STAGE_CODES,
  ASSESSMENT_TECHNICAL_COVERAGE_STATES,
  hasValidInterviewWaitingInvariant,
  isAssessmentInterviewOutcome,
  type AssessmentInterviewAuditRef,
  type AssessmentInterviewBlockedAction,
  type AssessmentInterviewQuestion,
  type AssessmentInterviewRuntimeState,
} from "@lcsp/contracts/evidence";
import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";
import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";

import {
  ASSESSMENT_ARTIFACT_AVAILABILITIES,
  ASSESSMENT_RUNTIME_AVAILABILITIES,
  ASSESSMENT_SIDEBAR_WORKFLOW_STAGES,
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
  type NormalizedAssessmentRuntime,
  type NormalizedAssessmentRepository,
  type NormalizedWorkflowStep,
  type NormalizedAssessmentWorkflow,
  type NormalizedCustomerActions,
  type NormalizeAssessmentRuntimeParams,
} from "../types/assessment-runtime-adapter.types";
import {
  WORKSPACE_RUNTIME_CONNECTION_STATES,
  type WorkspaceRuntimeConnectionState,
  type WorkspaceRuntimeRun,
  type WorkspaceRuntimeActivityItem,
} from "../types/workspace-runtime.types";
import { sanitizeAssessmentInterviewState } from "../../../lib/api/assessment-interview-client";
import {
  ARTIFACT_STATUSES,
  ARTIFACT_TYPES,
} from "../../artifacts/types/artifact.types";
import { stageLabel } from "./assessment-runtime-formatter";
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
  const { assessmentId, interviewState: rawInterviewInput, timeline: rawTimeline, coverageOverride } = params;

  // 1. Unwrap interview query/data state
  const {
    interviewData,
    isLoadingInterview,
    isInterviewError,
    dataUpdatedAt,
  } = extractInterviewInput(rawInterviewInput);

  const connectionState: WorkspaceRuntimeConnectionState =
    rawTimeline?.connectionState ?? WORKSPACE_RUNTIME_CONNECTION_STATES.connected;

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
    const isValidInvariant = hasValidInterviewWaitingInvariant(sanitizedInterview);
    if (!isValidInvariant) {
      contractErrors.push(
        `Invalid interview invariant: activeQuestion present but outcome is ${sanitizedInterview.outcome}`,
      );
    }
  }

  // 3. Identity normalization
  const audit: AssessmentInterviewAuditRef | null = sanitizedInterview?.audit ?? null;
  const identity: NormalizedAssessmentIdentity = {
    assessmentId,
    threadId: sanitizedInterview?.threadId ?? null,
    authenticatedActorId: audit?.authenticatedActorId ?? null,
    audit,
    contextRevision: sanitizedInterview?.contextRevision ?? audit?.contextRevision ?? null,
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
  });

  // 6. Interview normalization
  const interview = normalizeInterview({
    sanitizedInterview,
    isLoadingInterview,
    contractErrors,
    dataUpdatedAt,
  });

  // 7. Artifacts normalization
  const artifacts = normalizeArtifacts({
    assessmentId,
    workflow,
    interview,
    repositorySnapshot: rawTimeline?.repositorySnapshot ?? null,
    scanJobs: rawTimeline?.scanJobs ?? [],
    evidenceReports: rawTimeline?.evidenceReports ?? [],
  });

  // 8. Customer Actions normalization
  const customerActions = normalizeCustomerActions({
    interview,
    coverage,
    contractErrors,
    isLoadingInterview,
  });

  // 9. Derive authoritative presentation availability
  let availability: AssessmentRuntimeAvailability = ASSESSMENT_RUNTIME_AVAILABILITIES.ready;
  if (contractErrors.length > 0) {
    availability = ASSESSMENT_RUNTIME_AVAILABILITIES.invalid;
  } else if (isLoadingInterview) {
    availability = ASSESSMENT_RUNTIME_AVAILABILITIES.loading;
  } else if (connectionState === WORKSPACE_RUNTIME_CONNECTION_STATES.disconnected) {
    availability = ASSESSMENT_RUNTIME_AVAILABILITIES.disconnected;
  } else if (isInterviewError) {
    availability = ASSESSMENT_RUNTIME_AVAILABILITIES.unavailable;
  } else if (coverage.state === ASSESSMENT_TECHNICAL_COVERAGE_STATES.unavailable) {
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
    artifacts,
    customerActions,
    integration,
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
  if ("data" in queryLike || "isLoading" in queryLike || "isError" in queryLike) {
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
        isUnavailable: coverageOverride.state === ASSESSMENT_TECHNICAL_COVERAGE_STATES.unavailable,
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
}: {
  timeline?: AdapterTimelineInput | null;
  sanitizedInterview: AssessmentInterviewRuntimeState | null;
  repositorySnapshot: AdapterTimelineInput["repositorySnapshot"];
}): NormalizedAssessmentWorkflow {
  const currentRun = timeline?.currentRun ?? null;
  const recentActivity = timeline?.recentActivity ?? [];
  const latestRunId = timeline?.latestRunId ?? currentRun?.runId ?? null;

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
    (sanitizedInterview?.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved &&
      Boolean(sanitizedInterview.flags?.includes(ASSESSMENT_INTERVIEW_FLAGS.downstreamImpact)));

  return {
    stage: currentRun?.stage ?? (recentActivity[0]?.stage ?? null),
    status: currentRun?.status ?? (recentActivity[0]?.runStatus ?? null),
    currentRunId: latestRunId,
    activeTools: currentRun?.activeTools ?? [],
    recentActivity,
    lastEmittedAt: timeline?.lastEmittedAt ?? (recentActivity[0]?.emittedAt ?? null),
    isTargetedClarificationLoop,
    latestRun: currentRun,
    steps: normalizeWorkflowSteps({
      currentRun,
      recentActivity,
      repositorySnapshot,
    }),
  };
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
      sourceState: "PENDING",
    };
  }
  return {
    provider: snapshot.provider,
    repositoryFullName: snapshot.repositoryFullName,
    branch: snapshot.branch,
    pinnedCommit: snapshot.commitSha,
    sourceState: "AVAILABLE",
  };
}

function normalizeWorkflowSteps({
  currentRun,
  recentActivity,
  repositorySnapshot,
}: {
  currentRun: WorkspaceRuntimeRun | null;
  recentActivity: WorkspaceRuntimeActivityItem[];
  repositorySnapshot: AdapterTimelineInput["repositorySnapshot"];
}): NormalizedWorkflowStep[] {
  const defaultSteps = [
    [ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.repository, "pages.appShell.runtimePanelRepository"],
    [ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.scanner, "pages.appShell.assessmentSidebar.workflow.scanner"],
    [ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.interview, "pages.appShell.assessmentSidebar.workflow.interview"],
    [ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.rules, "pages.appShell.assessmentSidebar.workflow.rules"],
    [ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.planner, "pages.appShell.assessmentSidebar.workflow.planner"],
    [ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.investigate, "pages.appShell.assessmentSidebar.workflow.investigate"],
    [ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.gate, "pages.appShell.assessmentSidebar.workflow.gate"],
  ] as const;
  const steps = new Map<string, NormalizedWorkflowStep>([
    ...defaultSteps.map(([id, labelKey]) => [id, {
      id,
      label: resolveMessage(appLocale, labelKey as MessageKey),
      status: id === ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.repository && repositorySnapshot
        ? NORMALIZED_WORKFLOW_STEP_STATUSES.completed
        : NORMALIZED_WORKFLOW_STEP_STATUSES.queued,
      detail: null,
    } satisfies NormalizedWorkflowStep] as const),
  ]);
  const stageId = (stage: string) =>
    stage === ASSESSMENT_RUNTIME_STAGE_CODES.snapshot
      ? ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.repository
      : stage === ASSESSMENT_RUNTIME_STAGE_CODES.scan
        ? ASSESSMENT_SIDEBAR_WORKFLOW_STAGES.scanner
        : stage;
  for (const activity of [...recentActivity].reverse()) {
    const id = stageId(activity.stage);
    steps.set(id, {
      id,
      label: steps.has(id) ? steps.get(id)!.label : stageLabel(activity.stage),
      status: normalizeStepStatus(activity.runStatus),
      detail: activity.summary || null,
    });
  }
  if (currentRun) {
    const id = stageId(currentRun.stage);
    steps.set(id, {
      id,
      label: steps.has(id) ? steps.get(id)!.label : stageLabel(currentRun.stage),
      status: normalizeStepStatus(currentRun.status),
      detail: null,
    });
  }
  return [...steps.values()];
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
  const hasDownstreamImpact = flags.includes(ASSESSMENT_INTERVIEW_FLAGS.downstreamImpact);

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
  if (outcome === ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer && sanitizedInterview.activeQuestion) {
    activeQuestion = sanitizedInterview.activeQuestion;
  }

  return {
    outcome: isValidOutcome ? outcome : null,
    activeQuestion,
    flags,
    hasDownstreamImpact,
    contextAuthority: sanitizedInterview.contextAuthority ?? null,
    blockedActions,
    answerHistory: sanitizedInterview.answerHistory ?? [],
    pendingDraft: sanitizedInterview.pendingDraft ?? null,
    orchestrationRequested: Boolean(sanitizedInterview.orchestrationRequested),
    stale: sanitizedInterview.contextAuthority === ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.superseded,
    revalidating: false,
  };
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

  const snapshotJobs = scanJobs
    .filter((job) => job.assessmentId === repositorySnapshot.assessmentId && job.snapshotId === repositorySnapshot.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const latestJob = snapshotJobs[0];

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
  workflow,
  interview,
  repositorySnapshot,
  scanJobs,
  evidenceReports,
}: {
  assessmentId: string;
  workflow: NormalizedAssessmentWorkflow;
  interview: NormalizedAssessmentInterview;
  repositorySnapshot: AdapterTimelineInput["repositorySnapshot"];
  scanJobs: NonNullable<AdapterTimelineInput["scanJobs"]>;
  evidenceReports: NonNullable<AdapterTimelineInput["evidenceReports"]>;
}): NormalizedAssessmentArtifacts {
  // Program Evidence Graph artifact
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

  // Business Context artifact
  let businessContextAvailability: AssessmentArtifactAvailability = ASSESSMENT_ARTIFACT_AVAILABILITIES.waiting;
  if (
    interview.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.contextReady ||
    interview.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved
  ) {
    businessContextAvailability = ASSESSMENT_ARTIFACT_AVAILABILITIES.ready;
  } else if (
    interview.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer &&
    (interview.activeQuestion?.intent === ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify ||
      workflow.isTargetedClarificationLoop)
  ) {
    businessContextAvailability = ASSESSMENT_ARTIFACT_AVAILABILITIES.updating;
  } else if (interview.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved) {
    businessContextAvailability = ASSESSMENT_ARTIFACT_AVAILABILITIES.paused;
  } else if (interview.stale) {
    businessContextAvailability = ASSESSMENT_ARTIFACT_AVAILABILITIES.updating;
  }

  const businessContext: NormalizedAssessmentArtifactItem = {
    ref: { assessmentId, type: ARTIFACT_TYPES.businessContext },
    type: ARTIFACT_TYPES.businessContext,
    status: availabilityToArtifactStatus(businessContextAvailability),
    category: "WORKING_RESULT",
    id: "business-context",
    kind: "BUSINESS_CONTEXT",
    labelKey: "artifacts.types.businessContext",
    availability: businessContextAvailability,
    customerSafeSummary:
      businessContextAvailability === ASSESSMENT_ARTIFACT_AVAILABILITIES.ready
        ? "Business context confirmed"
        : null,
  };

  // Investigation Notes artifact
  let notesAvailability: AssessmentArtifactAvailability = ASSESSMENT_ARTIFACT_AVAILABILITIES.waiting;
  if (workflow.isTargetedClarificationLoop) {
    notesAvailability = ASSESSMENT_ARTIFACT_AVAILABILITIES.paused;
  } else if (
    workflow.stage === "INVESTIGATE" ||
    workflow.stage === "investigate" ||
    workflow.stage === ASSESSMENT_RUNTIME_STAGE_CODES.classification
  ) {
    notesAvailability =
      workflow.status === ASSESSMENT_RUNTIME_RUN_STATUSES.running
        ? ASSESSMENT_ARTIFACT_AVAILABILITIES.updating
        : ASSESSMENT_ARTIFACT_AVAILABILITIES.ready;
  }

  const investigationNotes: NormalizedAssessmentArtifactItem = {
    ref: { assessmentId, type: ARTIFACT_TYPES.investigationNotes },
    type: ARTIFACT_TYPES.investigationNotes,
    status: availabilityToArtifactStatus(notesAvailability),
    category: "WORKING_RESULT",
    id: "investigation-notes",
    kind: "INVESTIGATION_NOTES",
    labelKey: "artifacts.types.investigationNotes",
    availability: notesAvailability,
    customerSafeSummary:
      notesAvailability === ASSESSMENT_ARTIFACT_AVAILABILITIES.paused
        ? "Investigation paused for business context"
        : null,
  };

  const items: NormalizedAssessmentArtifactItem[] = [
    programEvidenceGraph,
    businessContext,
    investigationNotes,
  ];

  return {
    items,
    programEvidenceGraph,
    businessContext,
    investigationNotes,
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
}: {
  interview: NormalizedAssessmentInterview;
  coverage: NormalizedAssessmentCoverage;
  contractErrors: string[];
  isLoadingInterview: boolean;
}): NormalizedCustomerActions {
  if (contractErrors.length > 0 || isLoadingInterview) {
    return {
      canAnswerQuestion: false,
      canSubmitDraft: false,
      canSubmitBlockedAction: false,
      availableBlockedActions: [],
      canUseComposer: false,
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
    };
  }

  const isWaiting = interview.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer;
  const hasQuestion = Boolean(interview.activeQuestion);
  const isBlocked = interview.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved;

  const canAnswerQuestion = isWaiting && hasQuestion;
  const canSubmitDraft = canAnswerQuestion;
  const canSubmitBlockedAction = isBlocked && interview.blockedActions.length > 0;
  const canUseComposer = canAnswerQuestion;

  return {
    canAnswerQuestion,
    canSubmitDraft,
    canSubmitBlockedAction,
    availableBlockedActions: isBlocked ? interview.blockedActions : [],
    canUseComposer,
  };
}
