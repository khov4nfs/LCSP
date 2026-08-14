export const ASSESSMENT_RUNTIME_EVENT_TYPES = {
  runStarted: "RUN_STARTED",
  runStageChanged: "RUN_STAGE_CHANGED",
  toolStarted: "TOOL_STARTED",
  toolCompleted: "TOOL_COMPLETED",
  toolFailed: "TOOL_FAILED",
  toolWaitingInput: "TOOL_WAITING_INPUT",
  toolSkipped: "TOOL_SKIPPED",
  runCompleted: "RUN_COMPLETED",
  runFailed: "RUN_FAILED",
} as const;

export type AssessmentRuntimeEventType =
  (typeof ASSESSMENT_RUNTIME_EVENT_TYPES)[keyof typeof ASSESSMENT_RUNTIME_EVENT_TYPES];

export const ASSESSMENT_RUNTIME_RUN_STATUSES = {
  running: "RUNNING",
  waiting: "WAITING",
  completed: "COMPLETED",
  failed: "FAILED",
} as const;

export type AssessmentRuntimeRunStatus =
  (typeof ASSESSMENT_RUNTIME_RUN_STATUSES)[keyof typeof ASSESSMENT_RUNTIME_RUN_STATUSES];

export const ASSESSMENT_RUNTIME_STAGE_CODES = {
  snapshot: "SNAPSHOT",
  scan: "SCAN",
  technicalEvidence: "TECHNICAL_EVIDENCE",
  technicalProfile: "TECHNICAL_PROFILE",
  aiUsageFlow: "AI_USAGE_FLOW",
  reconciliation: "RECONCILIATION",
  classification: "CLASSIFICATION",
  conflicts: "CONFLICTS",
  documents: "DOCUMENTS",
  legalRetrieval: "LEGAL_RETRIEVAL",
} as const;

export type AssessmentRuntimeStageCode =
  (typeof ASSESSMENT_RUNTIME_STAGE_CODES)[keyof typeof ASSESSMENT_RUNTIME_STAGE_CODES];

export type AssessmentRuntimeSummaryValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: AssessmentRuntimeSummaryValue }
  | AssessmentRuntimeSummaryValue[];

export type AssessmentRuntimeActivityEvent = {
  eventId: string;
  sequence: number;
  emittedAt: string;
  organizationId: string;
  assessmentId: string;
  runId: string;
  correlationId: string;
  eventType: AssessmentRuntimeEventType;
  runStatus: AssessmentRuntimeRunStatus;
  stage: AssessmentRuntimeStageCode;
  toolName: string | null;
  summary: string;
  inputSummary: AssessmentRuntimeSummaryValue | null;
  outputSummary: AssessmentRuntimeSummaryValue | null;
  errorSummary: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  attempt: number | null;
  waitingReason: string | null;
};

export type AssessmentRuntimeActiveTool = {
  toolName: string;
  status: AssessmentRuntimeRunStatus;
  summary: string;
  startedAt: string | null;
  attempt: number | null;
};

export type AssessmentRuntimeRun = {
  assessmentId: string;
  runId: string;
  stage: AssessmentRuntimeStageCode;
  status: AssessmentRuntimeRunStatus;
  activeTools: AssessmentRuntimeActiveTool[];
  updatedAt: string;
};

export type AssessmentRuntimeSnapshot = {
  emittedAt: string;
  runs: AssessmentRuntimeRun[];
  recentActivity: AssessmentRuntimeActivityEvent[];
  scanJobs: unknown[];
  evidenceReports: unknown[];
};
