import type { AssessmentPostFindingRuntimeState } from "./assessment-post-finding-runtime.ts";
import type { RuleAnalysisActivity } from "./rule-assessment.ts";
import {
  agentExecutionStateSchema,
  assessmentLifecycleSchema,
} from "../assessment/agentic-runtime.ts";
import type { AssessmentEvent } from "../assessment/agentic-runtime.ts";
import { z } from "zod";

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

/**
 * Customer stop/continue of a running repository-analysis pipeline. The latest
 * control marker decides whether the pipeline is stopped: automatic
 * reconciliation never resumes a pipeline the customer stopped.
 */
export const ASSESSMENT_RUNTIME_PIPELINE_CONTROL_REASONS = {
  customerRequestedStop: "CUSTOMER_REQUESTED_STOP",
  customerRequestedContinue: "CUSTOMER_REQUESTED_CONTINUE",
} as const;

export type AssessmentRuntimePipelineControlReason =
  (typeof ASSESSMENT_RUNTIME_PIPELINE_CONTROL_REASONS)[keyof typeof ASSESSMENT_RUNTIME_PIPELINE_CONTROL_REASONS];

/** Tool name of the control markers; not agent activity, never a workflow step. */
export const ASSESSMENT_RUNTIME_PIPELINE_CONTROL_TOOL_NAME =
  "customer_pipeline_control";

export const ASSESSMENT_RUNTIME_STAGE_CODES = {
  snapshot: "SNAPSHOT",
  scan: "SCAN",
  technicalEvidence: "TECHNICAL_EVIDENCE",
  technicalProfile: "TECHNICAL_PROFILE",
  aiUsageFlow: "AI_USAGE_FLOW",
  reconciliation: "RECONCILIATION",
  interview: "INTERVIEW",
  classification: "CLASSIFICATION",
  conflicts: "CONFLICTS",
  documents: "DOCUMENTS",
  legalRetrieval: "LEGAL_RETRIEVAL",
  codeReview: "CODE_REVIEW",
  remediation: "REMEDIATION",
  verification: "VERIFICATION",
  finalAssessment: "FINAL_ASSESSMENT",
} as const;

export type AssessmentRuntimeStageCode =
  (typeof ASSESSMENT_RUNTIME_STAGE_CODES)[keyof typeof ASSESSMENT_RUNTIME_STAGE_CODES];

export const ASSESSMENT_RUNTIME_SYNTHETIC_TOOL_NAMES = {
  repositoryScan: "repository_scan",
  technicalEvidenceReport: "technical_evidence_report",
} as const;

/**
 * Deterministic EngineeringRule Gate. The API records exactly one terminal Gate event
 * in the same run as the Classification completion: COMPLETED when evaluations passed
 * through the gate, SKIPPED with a reason when the run had nothing to gate.
 */
export const ASSESSMENT_RUNTIME_GATE_TOOL_NAMES = {
  engineeringRuleGate: "engineering_rule_gate",
} as const;

export const ASSESSMENT_RUNTIME_GATE_STATUSES = {
  completed: "COMPLETED",
  skipped: "SKIPPED",
} as const;

export type AssessmentRuntimeGateStatus =
  (typeof ASSESSMENT_RUNTIME_GATE_STATUSES)[keyof typeof ASSESSMENT_RUNTIME_GATE_STATUSES];

export const ASSESSMENT_RUNTIME_STEP_SKIP_REASONS = {
  notRequired: "NOT_REQUIRED",
} as const;

export type AssessmentRuntimeStepSkipReason =
  (typeof ASSESSMENT_RUNTIME_STEP_SKIP_REASONS)[keyof typeof ASSESSMENT_RUNTIME_STEP_SKIP_REASONS];

export const ASSESSMENT_RUNTIME_SUMMARY_MESSAGE_KEYS = {
  engineeringRuleInvestigationFailed: "ENGINEERING_RULE_INVESTIGATION_FAILED",
  engineeringRuleInvestigated: "ENGINEERING_RULE_INVESTIGATED",
  engineeringRuleReadinessWaiting: "ENGINEERING_RULE_READINESS_WAITING",
} as const;

export type AssessmentRuntimeSummaryMessageKey =
  (typeof ASSESSMENT_RUNTIME_SUMMARY_MESSAGE_KEYS)[keyof typeof ASSESSMENT_RUNTIME_SUMMARY_MESSAGE_KEYS];

export type AssessmentRuntimeSummaryValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: AssessmentRuntimeSummaryValue }
  | AssessmentRuntimeSummaryValue[];

export const ASSESSMENT_AGENT_STREAM_SCHEMA_VERSIONS = {
  semanticV1: "AGENT_STREAM_SEMANTIC_V1",
} as const;

export type AssessmentAgentStreamSchemaVersion =
  (typeof ASSESSMENT_AGENT_STREAM_SCHEMA_VERSIONS)[keyof typeof ASSESSMENT_AGENT_STREAM_SCHEMA_VERSIONS];

export const ASSESSMENT_AGENT_STREAM_DURABILITY = {
  durable: "DURABLE",
  bestEffort: "BEST_EFFORT",
} as const;

export type AssessmentAgentStreamDurability =
  (typeof ASSESSMENT_AGENT_STREAM_DURABILITY)[keyof typeof ASSESSMENT_AGENT_STREAM_DURABILITY];

export const ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS = {
  scannerFile: "SCANNER_FILE",
  scannerSymbol: "SCANNER_SYMBOL",
  scannerDependency: "SCANNER_DEPENDENCY",
  scannerTraceStep: "SCANNER_TRACE_STEP",
  toolCall: "TOOL_CALL",
  toolResult: "TOOL_RESULT",
  engineeringRule: "ENGINEERING_RULE",
  skillUsage: "SKILL_USAGE",
  ruleProvenance: "RULE_PROVENANCE",
  modelRequest: "MODEL_REQUEST",
  modelOutput: "MODEL_OUTPUT",
  decisionModel: "DECISION_MODEL",
  reasoningSummary: "REASONING_SUMMARY",
  runtimeProgress: "RUNTIME_PROGRESS",
  ruleAnalysis: "RULE_ANALYSIS",
} as const;

export type AssessmentAgentStreamSemanticKind =
  (typeof ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS)[keyof typeof ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS];

export function isAssessmentAgentStreamSemanticKind(
  value: unknown,
): value is AssessmentAgentStreamSemanticKind {
  return Object.values(ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS).includes(
    value as AssessmentAgentStreamSemanticKind,
  );
}

export type AssessmentAgentStreamSemanticPayload = {
  schemaVersion: AssessmentAgentStreamSchemaVersion;
  kind: AssessmentAgentStreamSemanticKind;
  durability: AssessmentAgentStreamDurability;
  analyzer?: string;
  toolName?: string;
  toolVersion?: string;
  toolCallId?: string;
  filePath?: string;
  symbolRef?: string;
  functionName?: string;
  dependencyName?: string;
  traceId?: string;
  hop?: number;
  edgeType?: string;
  fromRef?: string;
  toRef?: string;
  resolutionState?: string;
  sourceAnchorRef?: string;
  evidenceRefs?: string[];
  parameters?: AssessmentRuntimeSummaryValue;
  resultSummary?: AssessmentRuntimeSummaryValue;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  engineeringRuleId?: string;
  engineeringRuleIds?: string[];
  ruleVersionRef?: string;
  concept?: string;
  investigationGoals?: string[];
  requiredEvidence?: string[];
  decision?: string;
  reasonCode?: string;
  /** Rule-analysis lifecycle step (RULE_ANALYSIS_ACTIVITIES) for RULE_ANALYSIS events. */
  activity?: RuleAnalysisActivity;
  evaluationStatus?: string;
  claimCount?: number;
  skillName?: string;
  skillVersionOrHash?: string;
  promptVersion?: string;
  ruleSetVersionOrHash?: string;
  agentName?: string;
  agentRole?: string;
  provider?: string;
  model?: string;
  nodeName?: string;
  goalSummary?: string;
  inputArtifactRefs?: string[];
  availableToolNames?: string[];
  requestId?: string;
  messageId?: string;
  status?: string;
  structuredOutputType?: string;
  outputRefs?: string[];
  usage?: AssessmentRuntimeSummaryValue;
  finishReason?: string;
};

export const ASSESSMENT_AGENT_STREAM_EVENT_TYPES = {
  boundaryStarted: "BOUNDARY_STARTED",
  boundaryCompleted: "BOUNDARY_COMPLETED",
  boundaryFailed: "BOUNDARY_FAILED",
  boundaryPaused: "BOUNDARY_PAUSED",
  runtimeStopRequested: "RUNTIME_STOP_REQUESTED",
  runtimeStopped: "RUNTIME_STOPPED",
  runtimeResumeRequested: "RUNTIME_RESUME_REQUESTED",
  runtimeResumed: "RUNTIME_RESUMED",
  runtimeCompleted: "RUNTIME_COMPLETED",
  agentStarted: "AGENT_STARTED",
  agentCompleted: "AGENT_COMPLETED",
  agentFailed: "AGENT_FAILED",
  agentBudgetReached: "AGENT_BUDGET_REACHED",
  agentContextTrimmed: "AGENT_CONTEXT_TRIMMED",
  subagentSelected: "SUBAGENT_SELECTED",
  modelContentDelta: "MODEL_CONTENT_DELTA",
  modelReasoningDelta: "MODEL_REASONING_DELTA",
  modelRequest: "MODEL_REQUEST",
  modelResult: "MODEL_RESULT",
  modelCallStarted: "MODEL_CALL_STARTED",
  modelCallHeartbeat: "MODEL_CALL_HEARTBEAT",
  modelCallCompleted: "MODEL_CALL_COMPLETED",
  modelCallCancelled: "MODEL_CALL_CANCELLED",
  modelCallFailed: "MODEL_CALL_FAILED",
  modelCallTimeout: "MODEL_CALL_TIMEOUT",
  decisionModelRequest: "DECISION_MODEL_REQUEST",
  decisionModelResult: "DECISION_MODEL_RESULT",
  decisionThresholdApplied: "DECISION_THRESHOLD_APPLIED",
  decisionFallback: "DECISION_FALLBACK",
  scannerActivity: "SCANNER_ACTIVITY",
  semanticToolCall: "SEMANTIC_TOOL_CALL",
  semanticToolResult: "SEMANTIC_TOOL_RESULT",
  engineeringRule: "ENGINEERING_RULE",
  skillUsage: "SKILL_USAGE",
  ruleProvenance: "RULE_PROVENANCE",
  toolCallDelta: "TOOL_CALL_DELTA",
  toolResult: "TOOL_RESULT",
  customProgress: "CUSTOM_PROGRESS",
  graphUpdate: "GRAPH_UPDATE",
  graphState: "GRAPH_STATE",
  runtimeEvent: "RUNTIME_EVENT",
  providerFallback: "PROVIDER_FALLBACK",
  credentialRotation: "CREDENTIAL_ROTATION",
  log: "LOG",
} as const;

export type AssessmentAgentStreamEventType =
  (typeof ASSESSMENT_AGENT_STREAM_EVENT_TYPES)[keyof typeof ASSESSMENT_AGENT_STREAM_EVENT_TYPES];

export function isAssessmentAgentStreamEventType(
  value: unknown,
): value is AssessmentAgentStreamEventType {
  return Object.values(ASSESSMENT_AGENT_STREAM_EVENT_TYPES).includes(
    value as AssessmentAgentStreamEventType,
  );
}

/** Customer-visible pipeline stage one live agent stream event belongs to. */
export const ASSESSMENT_AGENT_STREAM_STAGES = {
  scanner: "SCANNER",
  interview: "INTERVIEW",
  ruleAnalysis: "RULE_ANALYSIS",
  gate: "GATE",
} as const;

export type AssessmentAgentStreamStage =
  (typeof ASSESSMENT_AGENT_STREAM_STAGES)[keyof typeof ASSESSMENT_AGENT_STREAM_STAGES];

export function isAssessmentAgentStreamStage(
  value: unknown,
): value is AssessmentAgentStreamStage {
  return Object.values(ASSESSMENT_AGENT_STREAM_STAGES).includes(
    value as AssessmentAgentStreamStage,
  );
}

/**
 * Read alias for agent-stream events persisted before the Investigator stage
 * was renamed. Remove once no persisted `agentStreamEvent.stage` still holds
 * "INVESTIGATE" (runtime-event retention window elapsed).
 */
const LEGACY_AGENT_STREAM_STAGE_ALIASES: Readonly<Record<string, string>> = {
  INVESTIGATE: ASSESSMENT_AGENT_STREAM_STAGES.ruleAnalysis,
};

export function normalizePersistedAgentStreamStage(
  value: unknown,
): AssessmentAgentStreamStage | null {
  const mapped =
    typeof value === "string"
      ? (LEGACY_AGENT_STREAM_STAGE_ALIASES[value] ?? value)
      : value;
  return isAssessmentAgentStreamStage(mapped) ? mapped : null;
}

export type AssessmentAgentStreamEvent = {
  eventId: string;
  sequence: number;
  clientSequence: number | null;
  emittedAt: string;
  assessmentId: string;
  runId: string;
  correlationId: string;
  eventType: AssessmentAgentStreamEventType;
  stage: AssessmentAgentStreamStage | null;
  /** EngineeringRule this event's activity belongs to, while one is investigated. */
  engineeringRuleId: string | null;
  source: string | null;
  agentName: string | null;
  subagentName: string | null;
  namespace: string[];
  nodeName: string | null;
  messageId: string | null;
  toolName: string | null;
  toolCallId: string | null;
  status: string | null;
  text: string | null;
  data: AssessmentRuntimeSummaryValue | null;
};

export type AssessmentRuntimeActivityEvent = {
  eventId: string;
  sequence: number;
  emittedAt: string;
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

/**
 * Rule-analysis progress derived from the runtime events the repository-analyst loop
 * emits (`rule_analysis_summary` once, `rule_analysis:{engineeringRuleId}` per rule).
 * Pending rules are eligibleCount minus the four terminal counts.
 */
export type AssessmentRuntimeEngineeringProgress = {
  assessmentId: string;
  runId: string;
  contextRevision: number | null;
  engineeringRuleCount: number;
  eligibleCount: number;
  completed: number;
  needsContext: number;
  unresolved: number;
  failed: number;
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

const canonicalRuntimeIdentifierSchema = z.string().trim().min(1).max(200);
const canonicalRuntimeRevisionSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

/** Canonical AES projection shared by GET, workspace snapshots, and SSE. */
export const assessmentRuntimeSchema = z.strictObject({
  threadId: z.uuid(),
  rootAgentVersion: canonicalRuntimeIdentifierSchema,
  checkpointNamespace: z.uuid(),
  checkpointId: canonicalRuntimeIdentifierSchema.nullable(),
  currentExecutionId: z.uuid().nullable(),
  executionState: agentExecutionStateSchema,
  eventSequence: canonicalRuntimeRevisionSchema,
  startedAt: z.iso.datetime().nullable(),
  lastResumedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
});
export type AssessmentRuntime = z.infer<typeof assessmentRuntimeSchema>;

/** One canonical assessment projection; V1 rows are explicitly unavailable. */
export const canonicalAssessmentRuntimeSnapshotSchema = z
  .strictObject({
    assessmentId: z.uuid(),
    lifecycle: assessmentLifecycleSchema.nullable(),
    runtime: assessmentRuntimeSchema.nullable(),
  })
  .superRefine((value, context) => {
    if ((value.lifecycle === null) !== (value.runtime === null)) {
      context.addIssue({
        code: "custom",
        message:
          "Lifecycle and runtime canonical data must be present together",
      });
    }
  });
export type CanonicalAssessmentRuntimeSnapshot = z.infer<
  typeof canonicalAssessmentRuntimeSnapshotSchema
>;

/**
 * Stage lifecycle derived from durable artifacts and dispatch boundaries.
 *
 * Runtime events are an activity log, not the source of truth for whether a
 * stage finished: a later repository-analyst dispatch posts scan-tagged
 * bookkeeping, and a stage-less boundary failure belongs to whatever was
 * running. The API therefore derives each stage from what durably exists
 * (scan job, accepted evidence, confirmed context revision, per-rule
 * assessments) so the sidebar and composer always agree.
 */
export const ASSESSMENT_STAGE_LIFECYCLE_STATES = {
  queued: "QUEUED",
  running: "RUNNING",
  done: "DONE",
  partial: "PARTIAL",
  failed: "FAILED",
  waitingForCustomer: "WAITING_FOR_CUSTOMER",
  contextConfirmed: "CONTEXT_CONFIRMED",
  blocked: "BLOCKED",
  claimsPartial: "CLAIMS_PARTIAL",
  claimsComplete: "CLAIMS_COMPLETE",
  needsContext: "NEEDS_CONTEXT",
  timeout: "TIMEOUT",
  ready: "READY",
} as const;

export type AssessmentStageLifecycleState =
  (typeof ASSESSMENT_STAGE_LIFECYCLE_STATES)[keyof typeof ASSESSMENT_STAGE_LIFECYCLE_STATES];

export type AssessmentStageLifecycleEntry = {
  state: AssessmentStageLifecycleState;
  /** Durable artifact this state was derived from, for auditing the projection. */
  source: string;
  detail: string | null;
};

export type AssessmentStageLifecycle = {
  scanner: AssessmentStageLifecycleEntry;
  interview: AssessmentStageLifecycleEntry;
  ruleAnalysis: AssessmentStageLifecycleEntry;
  gate: AssessmentStageLifecycleEntry;
};

export type AssessmentStageLifecycleProjection = AssessmentStageLifecycle & {
  assessmentId: string;
};

export type AssessmentRuntimeSnapshot = {
  emittedAt: string;
  runs: AssessmentRuntimeRun[];
  recentActivity: AssessmentRuntimeActivityEvent[];
  engineeringProgress: AssessmentRuntimeEngineeringProgress[];
  repositorySnapshots: unknown[];
  scanJobs: unknown[];
  evidenceReports: unknown[];
  postFindingStates: AssessmentPostFindingRuntimeState[];
  /** One entry per assessment the owner can see. */
  stageLifecycles: AssessmentStageLifecycleProjection[];
  /** Canonical ALS/AES projections; null lifecycle/runtime means V1 unavailable. */
  canonicalAssessments: CanonicalAssessmentRuntimeSnapshot[];
  /** Strict canonical AssessmentEvent envelopes, never transport metadata. */
  canonicalEvents: AssessmentEvent[];
};
