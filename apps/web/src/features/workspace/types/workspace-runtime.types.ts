import type { MessageKey } from "@lcsp/i18n";
import type {
  AssessmentAgentStreamEvent,
  AssessmentPostFindingRuntimeState,
  AssessmentRuntimeEngineeringProgress,
} from "@lcsp/contracts/evidence";

export const WORKSPACE_RUNTIME_CONNECTION_STATES = {
  connecting: "CONNECTING",
  connected: "CONNECTED",
  disconnected: "DISCONNECTED",
} as const;

export type WorkspaceRuntimeConnectionState =
  (typeof WORKSPACE_RUNTIME_CONNECTION_STATES)[keyof typeof WORKSPACE_RUNTIME_CONNECTION_STATES];

export type WorkspaceRuntimeScanJob = {
  id: string;
  assessmentId: string;
  snapshotId: string;
  status: string;
  attemptCount: number;
  blockedReason: string | null;
  updatedAt: string;
};

export type WorkspaceRuntimeEvidenceReport = {
  id: string;
  assessmentId: string;
  scanJobId: string;
  snapshotId: string;
  status: string;
  rejectionReason: string | null;
  createdAt: string;
};

export type WorkspaceRuntimeRepositorySnapshot = {
  id: string;
  assessmentId: string;
  provider: string | null;
  repositoryFullName: string | null;
  branch: string | null;
  commitSha: string;
  createdAt: string;
};

export type WorkspaceRuntimeSummaryValue =
  | string
  | number
  | boolean
  | null
  | WorkspaceRuntimeSummaryValue[]
  | { [key: string]: WorkspaceRuntimeSummaryValue };

export type WorkspaceRuntimeActiveTool = {
  toolName: string;
  status: string;
  summary: string;
  startedAt: string | null;
  attempt: number | null;
};

export type WorkspaceRuntimeRun = {
  assessmentId: string;
  runId: string;
  stage: string;
  status: string;
  activeTools: WorkspaceRuntimeActiveTool[];
  updatedAt: string;
};

export type WorkspaceRuntimeActivityItem = {
  eventId: string;
  sequence: number;
  emittedAt: string;
  assessmentId: string;
  runId: string;
  correlationId: string;
  eventType: string;
  runStatus: string;
  stage: string;
  toolName: string | null;
  summary: string;
  inputSummary: WorkspaceRuntimeSummaryValue | null;
  outputSummary: WorkspaceRuntimeSummaryValue | null;
  errorSummary: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  attempt: number | null;
  waitingReason: string | null;
};

export type WorkspaceRuntimeAssessmentTimeline = {
  currentRun: WorkspaceRuntimeRun | null;
  recentActivity: WorkspaceRuntimeActivityItem[];
  engineeringProgress?: AssessmentRuntimeEngineeringProgress[];
  agentStreamEvents?: AssessmentAgentStreamEvent[];
  latestRunId: string | null;
  connectionState: WorkspaceRuntimeConnectionState;
  lastEmittedAt: string | null;
  postFinding: AssessmentPostFindingRuntimeState | null;
};

export type WorkspaceRuntimeSnapshot = {
  emittedAt: string | null;
  runs: WorkspaceRuntimeRun[];
  recentActivity: WorkspaceRuntimeActivityItem[];
  engineeringProgress: AssessmentRuntimeEngineeringProgress[];
  repositorySnapshots: WorkspaceRuntimeRepositorySnapshot[];
  scanJobs: WorkspaceRuntimeScanJob[];
  evidenceReports: WorkspaceRuntimeEvidenceReport[];
  postFindingStates: AssessmentPostFindingRuntimeState[];
};

export type WorkspaceRuntimeContextValue = WorkspaceRuntimeSnapshot & {
  connectionState: WorkspaceRuntimeConnectionState;
  runsByAssessmentId: Record<string, WorkspaceRuntimeRun[]>;
  recentActivityByAssessmentId: Record<string, WorkspaceRuntimeActivityItem[]>;
  engineeringProgressByAssessmentId: Record<
    string,
    AssessmentRuntimeEngineeringProgress[]
  >;
  agentStreamEventsByAssessmentId: Record<string, AssessmentAgentStreamEvent[]>;
  latestRunIdByAssessmentId: Record<string, string>;
  postFindingByAssessmentId: Record<string, AssessmentPostFindingRuntimeState>;
  getAssessmentRuntime: (
    assessmentId: string,
  ) => WorkspaceRuntimeAssessmentTimeline;
};

export const RUNTIME_THINKING_PHASES = {
  planner: "PLANNER",
  investigator: "INVESTIGATOR",
} as const;

export type RuntimeThinkingPhase =
  (typeof RUNTIME_THINKING_PHASES)[keyof typeof RUNTIME_THINKING_PHASES];

/** Customer-facing aggregate of internal Planner/Investigator runtime telemetry. */
export type RuntimeThinkingItem = {
  id: string;
  phase: RuntimeThinkingPhase;
  limited: boolean;
  messageKey: MessageKey;
  params: Record<string, string>;
};
