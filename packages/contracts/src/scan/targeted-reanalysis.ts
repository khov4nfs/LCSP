/**
 * Versioned admission policy for command.scan.targeted-reanalysis.v1.
 * Values are deliberately centralized so API admission, scheduler, worker and
 * observability use the same fairness and retry budget.
 */
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
