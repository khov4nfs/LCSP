import {
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

import type {
  WorkspaceRuntimeActivityItem,
  WorkspaceRuntimeActiveTool,
  WorkspaceRuntimeConnectionState,
  WorkspaceRuntimeRun,
} from "./workspace-runtime.types";

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
};

export type NormalizedAssessmentArtifactItem = {
  id: string;
  kind: string;
  labelKey: string;
  availability: AssessmentArtifactAvailability;
  customerSafeSummary: string | null;
  referenceUrl?: string;
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
