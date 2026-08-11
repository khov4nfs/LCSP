import type {
  AgenticToolName,
  AgenticToolStatus,
} from "../evidence/agentic-tool.ts";
import { AGENTIC_TOOL_NAMES } from "../evidence/agentic-tool.ts";

/**
 * Versioned admission policy for command.scan.targeted-reanalysis.v1.
 * Values are deliberately centralized so API admission, scheduler, worker and
 * observability use the same fairness and retry budget.
 */
export const REQUEST_TARGETED_REANALYSIS_TOOL = {
  name: AGENTIC_TOOL_NAMES.requestTargetedReanalysis,
  version: "1.0.0",
  configHash: "sha256:reanalysis-v1",
  maxPathPrefixes: 20,
  maxSubjectRefs: 50,
} as const;

const STABLE_EVIDENCE_REPORT_ID = "^ter_[A-Za-z0-9_-]{8,120}$";
const STABLE_REASON_REQUIREMENT_ID = "^requirement:[A-Za-z0-9_-]{1,120}$";
const STABLE_SCOPE_PATH = "^(?!/|.*\\.\\.)[A-Za-z0-9._/-]+/$";
const STABLE_SCOPE_SUBJECT_REF =
  "^(finding|symbol|node):[A-Za-z0-9_-]{8,120}$";
const STABLE_IDEMPOTENCY_KEY = "^[A-Za-z0-9_-]{16,128}$";

export const REQUEST_TARGETED_REANALYSIS_INPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "inputArtifactVersion",
    "analyzerId",
    "scope",
    "reasonRequirementId",
    "idempotencyKey",
  ],
  properties: {
    inputArtifactVersion: {
      type: "string",
      pattern: STABLE_EVIDENCE_REPORT_ID,
    },
    analyzerId: {
      enum: [
        "RUN_SEMGREP_RULES",
        "RUN_PYTHON_SEMANTIC_ANALYSIS",
        "RUN_TS_JS_SEMANTIC_ANALYSIS",
        "RUN_STRUCTURAL_AUGMENTATION",
      ],
    },
    scope: {
      type: "object",
      additionalProperties: false,
      minProperties: 1,
      maxProperties: 1,
      properties: {
        pathPrefixes: {
          type: "array",
          minItems: 1,
          maxItems: REQUEST_TARGETED_REANALYSIS_TOOL.maxPathPrefixes,
          uniqueItems: true,
          items: {
            type: "string",
            pattern: STABLE_SCOPE_PATH,
          },
        },
        subjectRefs: {
          type: "array",
          minItems: 1,
          maxItems: REQUEST_TARGETED_REANALYSIS_TOOL.maxSubjectRefs,
          uniqueItems: true,
          items: {
            type: "string",
            pattern: STABLE_SCOPE_SUBJECT_REF,
          },
        },
      },
    },
    reasonRequirementId: {
      type: "string",
      pattern: STABLE_REASON_REQUIREMENT_ID,
    },
    idempotencyKey: {
      type: "string",
      pattern: STABLE_IDEMPOTENCY_KEY,
    },
  },
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

export type RequestTargetedReanalysisInput = {
  inputArtifactVersion: string;
  analyzerId: string;
  scope:
    | {
        pathPrefixes: string[];
      }
    | {
        subjectRefs: string[];
      };
  reasonRequirementId: string;
  idempotencyKey: string;
};

export type RequestTargetedReanalysisResponse = {
  status: AgenticToolStatus;
  toolName: AgenticToolName;
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
