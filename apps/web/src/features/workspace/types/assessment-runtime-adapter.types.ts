import {
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  ASSESSMENT_TECHNICAL_COVERAGE_STATES,
  type AssessmentContextAuthorityStatus,
  type AssessmentInterviewAnswerHistoryItem,
  type AssessmentInterviewAuditRef,
  type AssessmentInterviewBlockedAction,
  type AssessmentInterviewFlag,
  type AssessmentInterviewOutcome,
  type AssessmentInterviewQuestion,
  type AssessmentTechnicalCoverageState,
} from "@lcsp/contracts/evidence";
import {
  PROVIDER_CREDENTIAL_STATUSES,
  REPOSITORY_SCAN_JOB_STATUSES,
} from "@lcsp/contracts/github-integration";

import type {
  WorkspaceRuntimeActivityItem,
  WorkspaceRuntimeActiveTool,
  WorkspaceRuntimeConnectionState,
  WorkspaceRuntimeRepositorySnapshot,
  WorkspaceRuntimeScanJob,
  WorkspaceRuntimeEvidenceReport,
  WorkspaceRuntimeRun,
} from "./workspace-runtime.types";
import type {
  ArtifactRef,
  ArtifactStatus,
  ArtifactType,
} from "@/features/artifacts/types/artifact.types";

export const ASSESSMENT_RUNTIME_AVAILABILITIES = {
  loading: "LOADING",
  ready: ASSESSMENT_TECHNICAL_COVERAGE_STATES.ready,
  disconnected: "DISCONNECTED",
  unavailable: ASSESSMENT_TECHNICAL_COVERAGE_STATES.unavailable,
  invalid: "INVALID",
} as const;

export type AssessmentRuntimeAvailability =
  (typeof ASSESSMENT_RUNTIME_AVAILABILITIES)[keyof typeof ASSESSMENT_RUNTIME_AVAILABILITIES];

export const ASSESSMENT_ARTIFACT_AVAILABILITIES = {
  ready: ASSESSMENT_TECHNICAL_COVERAGE_STATES.ready,
  waiting: "WAITING",
  updating: "UPDATING",
  paused: "PAUSED",
  unavailable: ASSESSMENT_TECHNICAL_COVERAGE_STATES.unavailable,
} as const;

export type AssessmentArtifactAvailability =
  (typeof ASSESSMENT_ARTIFACT_AVAILABILITIES)[keyof typeof ASSESSMENT_ARTIFACT_AVAILABILITIES];

export const ASSESSMENT_SCREEN_PROJECTIONS = {
  f01: "F01",
  f02: "F02",
  f03: "F03",
  f04: "F04",
  f05: "F05",
  f06: "F06",
  f07: "F07",
  f08: "F08",
  f09: "F09",
  f10: "F10",
  f11: "F11",
  f12: "F12",
  f13: "F13",
  f14: "F14",
  f15: "F15",
  f16: "F16",
} as const;

export type AssessmentScreenProjection =
  (typeof ASSESSMENT_SCREEN_PROJECTIONS)[keyof typeof ASSESSMENT_SCREEN_PROJECTIONS];

export const ASSESSMENT_SIDEBAR_WORKFLOW_STAGES = {
  repository: "REPOSITORY",
  scanner: "SCANNER",
  interview: "INTERVIEW",
  rules: "RULES",
  planner: "PLANNER",
  investigate: "INVESTIGATE",
  gate: "GATE",
} as const;

export type AssessmentSidebarWorkflowStage =
  (typeof ASSESSMENT_SIDEBAR_WORKFLOW_STAGES)[keyof typeof ASSESSMENT_SIDEBAR_WORKFLOW_STAGES];

export const ASSESSMENT_SIDEBAR_STATUSES = {
  running: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
  queued: REPOSITORY_SCAN_JOB_STATUSES.queued,
  passed: "PASSED",
  building: "BUILDING",
  ready: ASSESSMENT_TECHNICAL_COVERAGE_STATES.ready,
  waiting: ASSESSMENT_RUNTIME_RUN_STATUSES.waiting,
  failed: ASSESSMENT_RUNTIME_RUN_STATUSES.failed,
} as const;

export type AssessmentSidebarStatus =
  (typeof ASSESSMENT_SIDEBAR_STATUSES)[keyof typeof ASSESSMENT_SIDEBAR_STATUSES];

export type NormalizedCoveragePolicyDecision = {
  permittedForInterview: boolean;
  policyDecisionRef?: string;
  policyVersion?: string;
};

export type NormalizedAssessmentCoverage = {
  state: AssessmentTechnicalCoverageState;
  limitations: string[];
  policyDecision: NormalizedCoveragePolicyDecision | null;
  recovery: {
    isUnavailable: boolean;
    reason: string | null;
  };
};

export type NormalizedAssessmentIdentity = {
  assessmentId: string;
  threadId: string | null;
  authenticatedActorId: string | null;
  audit: AssessmentInterviewAuditRef | null;
  contextRevision: number | null;
  priorRevision: number | null;
  newRevision: number | null;
};

export type NormalizedAssessmentInterview = {
  outcome: AssessmentInterviewOutcome | null;
  activeQuestion: AssessmentInterviewQuestion | null;
  flags: AssessmentInterviewFlag[];
  hasDownstreamImpact: boolean;
  contextAuthority: AssessmentContextAuthorityStatus | null;
  blockedActions: AssessmentInterviewBlockedAction[];
  answerHistory: AssessmentInterviewAnswerHistoryItem[];
  pendingDraft: string | null;
  orchestrationRequested: boolean;
  stale: boolean;
  revalidating: boolean;
};

export type NormalizedAssessmentWorkflow = {
  stage: string | null;
  status: string | null;
  currentRunId: string | null;
  activeTools: WorkspaceRuntimeActiveTool[];
  recentActivity: WorkspaceRuntimeActivityItem[];
  lastEmittedAt: string | null;
  isTargetedClarificationLoop: boolean;
  latestRun: WorkspaceRuntimeRun | null;
  steps: NormalizedWorkflowStep[];
};

export const NORMALIZED_WORKFLOW_STEP_STATUSES = {
  queued: REPOSITORY_SCAN_JOB_STATUSES.queued,
  running: REPOSITORY_SCAN_JOB_STATUSES.running,
  waiting: "WAITING",
  completed: REPOSITORY_SCAN_JOB_STATUSES.completed,
  failed: REPOSITORY_SCAN_JOB_STATUSES.failed,
  unknown: "UNKNOWN",
} as const;

export type NormalizedWorkflowStepStatus =
  (typeof NORMALIZED_WORKFLOW_STEP_STATUSES)[keyof typeof NORMALIZED_WORKFLOW_STEP_STATUSES];

export type NormalizedWorkflowStep = {
  id: string;
  label: string;
  status: NormalizedWorkflowStepStatus;
  detail: string | null;
};

export const NORMALIZED_REPOSITORY_SOURCE_STATES = {
  available: "AVAILABLE",
  pending: PROVIDER_CREDENTIAL_STATUSES.pending,
  unavailable: "UNAVAILABLE",
} as const;

export type NormalizedRepositorySourceState =
  (typeof NORMALIZED_REPOSITORY_SOURCE_STATES)[keyof typeof NORMALIZED_REPOSITORY_SOURCE_STATES];

export const NORMALIZED_ARTIFACT_CATEGORIES = {
  durableArtifact: "DURABLE_ARTIFACT",
  technicalEvidence: "TECHNICAL_EVIDENCE",
  workingResult: "WORKING_RESULT",
  sourceReference: "SOURCE_REFERENCE",
} as const;

export type NormalizedArtifactCategory =
  (typeof NORMALIZED_ARTIFACT_CATEGORIES)[keyof typeof NORMALIZED_ARTIFACT_CATEGORIES];

export type NormalizedAssessmentRepository = {
  provider: string | null;
  repositoryFullName: string | null;
  branch: string | null;
  pinnedCommit: string | null;
  sourceState: NormalizedRepositorySourceState;
};

export type NormalizedAssessmentArtifactItem = {
  ref: ArtifactRef;
  type: ArtifactType;
  status: ArtifactStatus;
  category: NormalizedArtifactCategory;
  id: string;
  kind: string;
  labelKey: string;
  availability: AssessmentArtifactAvailability;
  customerSafeSummary: string | null;
  referenceUrl?: string;
};

export type NormalizedAssessmentSidebarWorkflowItem = {
  id: AssessmentSidebarWorkflowStage;
  labelKey: string;
  status: AssessmentSidebarStatus;
};

export type NormalizedAssessmentSidebarArtifactItem = {
  id: string;
  labelKey: string;
  descriptionKey: string;
  status: AssessmentSidebarStatus;
  descriptionParams?: Record<string, string>;
  artifact: NormalizedAssessmentArtifactItem;
};

export type NormalizedAssessmentSidebarPresentation = {
  repository: Pick<
    WorkspaceRuntimeRepositorySnapshot,
    "repositoryFullName" | "branch" | "commitSha"
  > | null;
  workflow: NormalizedAssessmentSidebarWorkflowItem[];
  artifacts: NormalizedAssessmentSidebarArtifactItem[];
  artifactSummaryKey: string;
};

export type NormalizedAssessmentArtifacts = {
  items: NormalizedAssessmentArtifactItem[];
  programEvidenceGraph: NormalizedAssessmentArtifactItem;
  businessContext: NormalizedAssessmentArtifactItem;
  investigationNotes: NormalizedAssessmentArtifactItem;
};

export type NormalizedCustomerActions = {
  canAnswerQuestion: boolean;
  canSubmitDraft: boolean;
  canSubmitBlockedAction: boolean;
  availableBlockedActions: AssessmentInterviewBlockedAction[];
  canUseComposer: boolean;
};

export type NormalizedAssessmentIntegration = {
  missingFields: string[];
  contractErrors: string[];
  isContractValid: boolean;
};

export type NormalizedAssessmentRuntime = {
  availability: AssessmentRuntimeAvailability;
  connectionState: WorkspaceRuntimeConnectionState;
  identity: NormalizedAssessmentIdentity;
  repository: NormalizedAssessmentRepository;
  coverage: NormalizedAssessmentCoverage;
  workflow: NormalizedAssessmentWorkflow;
  interview: NormalizedAssessmentInterview;
  artifacts: NormalizedAssessmentArtifacts;
  customerActions: NormalizedCustomerActions;
  integration: NormalizedAssessmentIntegration;
};

export type AdapterInterviewStateInput = {
  data?: unknown;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  dataUpdatedAt?: number;
};

export type AdapterTimelineInput = {
  currentRun: WorkspaceRuntimeRun | null;
  recentActivity: WorkspaceRuntimeActivityItem[];
  latestRunId: string | null;
  connectionState: WorkspaceRuntimeConnectionState;
  lastEmittedAt: string | null;
  repositorySnapshot?: WorkspaceRuntimeRepositorySnapshot | null;
  scanJobs?: WorkspaceRuntimeScanJob[];
  evidenceReports?: WorkspaceRuntimeEvidenceReport[];
};

export type NormalizeAssessmentRuntimeParams = {
  assessmentId: string;
  interviewState?: unknown | AdapterInterviewStateInput | null;
  timeline?: AdapterTimelineInput | null;
  coverageOverride?: {
    state?: AssessmentTechnicalCoverageState;
    limitations?: string[];
    policyDecision?: NormalizedCoveragePolicyDecision | null;
    recoveryReason?: string | null;
  };
};
