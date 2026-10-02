import type { AgenticToolStatus } from "../evidence/agentic-tool.ts";

/**
 * Versioned admission policy for command.scan.targeted-reanalysis.v1.
 * Values are deliberately centralized so API admission, scheduler, worker and
 * observability use the same fairness and retry budget.
 */
export const REQUEST_TARGETED_REANALYSIS_TOOL = {
  name: "request_targeted_reanalysis",
  version: "1.0.0",
  configHash: "sha256:reanalysis-v1",
  maxCriterionIds: 50,
} as const;

/**
 * Retry scope of one EngineeringRule. Reanalysis re-runs the repository analyst for
 * exactly this rule and its criteria at the named confirmed-context revision; no file
 * path, subject reference or free-text query ever enters the API.
 */
export const REQUEST_TARGETED_REANALYSIS_RULE_SCOPE = {
  version: "3.0.0",
} as const;

export const TARGETED_REANALYSIS_CAPACITY_POLICY = {
  maxRunningPerOrganization: 2,
  maxQueuedPerOrganization: 10,
  maxActivePerOrganization: 12,
  maxRequestsPerFifteenMinutes: 12,
  maxRequestsPerTwentyFourHours: 40,
  globalWorkerSlots: 4,
  apiOutboxRetryCount: 3,
  apiOutboxMaxAttempts: 4,
  workerRetryCount: 3,
  workerMaxDeliveries: 4,
  scanTimeoutSeconds: 600,
} as const;

export const TARGETED_REANALYSIS_REQUEST_STATES = {
  queued: "QUEUED",
  dispatched: "DISPATCHED",
  running: "RUNNING",
  completed: "COMPLETED",
  failed: "FAILED",
  dlq: "DLQ",
} as const;

export type TargetedReanalysisRequestState =
  (typeof TARGETED_REANALYSIS_REQUEST_STATES)[keyof typeof TARGETED_REANALYSIS_REQUEST_STATES];

export const TARGETED_REANALYSIS_TERMINAL_STATES = {
  completed: TARGETED_REANALYSIS_REQUEST_STATES.completed,
  failed: TARGETED_REANALYSIS_REQUEST_STATES.failed,
  dlq: TARGETED_REANALYSIS_REQUEST_STATES.dlq,
} as const;

export type TargetedReanalysisTerminalState =
  (typeof TARGETED_REANALYSIS_TERMINAL_STATES)[keyof typeof TARGETED_REANALYSIS_TERMINAL_STATES];

export const TARGETED_REANALYSIS_CHECKPOINT_STATES = {
  pendingDispatch: "PENDING_DISPATCH",
  dispatched: "DISPATCHED",
  running: "RUNNING",
  retryScheduled: "RETRY_SCHEDULED",
  completed: "COMPLETED",
  failed: "FAILED",
  dlq: "DLQ",
} as const;

export type TargetedReanalysisCheckpointState =
  (typeof TARGETED_REANALYSIS_CHECKPOINT_STATES)[keyof typeof TARGETED_REANALYSIS_CHECKPOINT_STATES];

export const TARGETED_REANALYSIS_BLOCK_CODES = {
  capacityExhausted: "TENANT_REANALYSIS_CAPACITY_EXHAUSTED",
  rateLimited: "TENANT_REANALYSIS_RATE_LIMITED",
} as const;

export type TargetedReanalysisBlockCode =
  (typeof TARGETED_REANALYSIS_BLOCK_CODES)[keyof typeof TARGETED_REANALYSIS_BLOCK_CODES];

export const TARGETED_REANALYSIS_COMMAND =
  "command.scan.targeted-reanalysis.v1";

export const TARGETED_REANALYSIS_RESPONSE_STATES = {
  queued: "QUEUED",
  alreadyQueued: "ALREADY_QUEUED",
} as const;

export type TargetedReanalysisResponseState =
  (typeof TARGETED_REANALYSIS_RESPONSE_STATES)[keyof typeof TARGETED_REANALYSIS_RESPONSE_STATES];

export const TARGETED_REANALYSIS_COVERAGE_STATES = {
  pending: "PENDING",
} as const;

export type TargetedReanalysisCoverageState =
  (typeof TARGETED_REANALYSIS_COVERAGE_STATES)[keyof typeof TARGETED_REANALYSIS_COVERAGE_STATES];

export type TargetedReanalysisRuleScope = {
  engineeringRuleId: string;
  criterionIds: string[];
  contextRevision: number;
  priorResultId?: string;
};

export type RequestTargetedReanalysisInput = {
  inputArtifactVersion: string;
  analyzerId: string;
  scope: {
    ruleScope: TargetedReanalysisRuleScope;
  };
  reasonRequirementId: string;
  idempotencyKey: string;
};

export type RequestTargetedReanalysisResponse = {
  status: AgenticToolStatus;
  toolName: typeof REQUEST_TARGETED_REANALYSIS_TOOL.name;
  toolVersion: string;
  configHash: string;
  correlationId: string;
  artifactVersions: {
    technicalEvidenceReportId: string;
  };
  provenanceRef: string;
  coverageState: TargetedReanalysisCoverageState;
  evidenceRefs: string[];
  limitations: Array<{
    code: TargetedReanalysisBlockCode | string;
    affectedScopeRef: string | null;
    reason: string;
    retryable: boolean;
  }>;
  result: {
    reanalysisRequestId: string;
    state: TargetedReanalysisResponseState;
    inputArtifactVersion: string;
    requestedAnalyzer: string;
    scopeRef: string;
    checkpointRef: string;
    auditRef: string;
  };
};
