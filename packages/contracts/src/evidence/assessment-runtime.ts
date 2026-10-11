import {
  agentExecutionStateSchema,
  assessmentLifecycleSchema,
  assessmentEventSchema,
} from "../assessment/agentic-runtime.ts";
import type { AssessmentEvent } from "../assessment/agentic-runtime.ts";
import { z } from "zod";

export const ASSESSMENT_RUNTIME_RUN_STATUSES = {
  running: "RUNNING",
  waiting: "WAITING",
  completed: "COMPLETED",
  failed: "FAILED",
} as const;

export type AssessmentRuntimeRunStatus =
  (typeof ASSESSMENT_RUNTIME_RUN_STATUSES)[keyof typeof ASSESSMENT_RUNTIME_RUN_STATUSES];

export type AssessmentRuntimeSummaryValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: AssessmentRuntimeSummaryValue }
  | AssessmentRuntimeSummaryValue[];

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

export type AssessmentAgentStreamEvent = {
  eventId: string;
  sequence: number;
  clientSequence: number | null;
  emittedAt: string;
  assessmentId: string;
  runId: string;
  correlationId: string;
  eventType: AssessmentAgentStreamEventType;
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

export type AssessmentRuntimeSnapshot = {
  emittedAt: string;
  canonicalAssessments: CanonicalAssessmentRuntimeSnapshot[];
  canonicalEvents: AssessmentEvent[];
};

/** Canonical customer SSE boundary. Resource-local scan status has its own endpoint. */
export const workspaceAssessmentSnapshotSchema = z.strictObject({
  emitted_at: z.iso.datetime(),
  canonical_assessments: z.array(canonicalAssessmentRuntimeSnapshotSchema),
  canonical_events: z.array(assessmentEventSchema),
});

/** Bounded observer metadata, never decision or lifecycle authority. */
export const ASSESSMENT_AGENT_STREAM_SCHEMA_VERSIONS = {
  semanticV2: "AGENT_STREAM_SEMANTIC_V2",
} as const;
export const ASSESSMENT_AGENT_STREAM_DURABILITY = {
  durable: "DURABLE",
  bestEffort: "BEST_EFFORT",
} as const;
export const ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS = {
  toolCall: "TOOL_CALL",
  toolResult: "TOOL_RESULT",
  skillUsage: "SKILL_USAGE",
  ruleProvenance: "RULE_PROVENANCE",
  modelRequest: "MODEL_REQUEST",
  modelOutput: "MODEL_OUTPUT",
  reasoningSummary: "REASONING_SUMMARY",
  runtimeProgress: "RUNTIME_PROGRESS",
} as const;
