import type { AssessmentPostFindingRuntimeState } from "./assessment-post-finding-runtime.ts";

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

/** Planner reason codes the workspace projection needs to aggregate runtime activity. */
export const ASSESSMENT_RUNTIME_PLAN_REASON_CODES = {
  targetedExactResumePin: "TARGETED_EXACT_RESUME_PIN",
} as const;

export const ASSESSMENT_RUNTIME_SUMMARY_MESSAGE_KEYS = {
  engineeringRulePlannerDecision: "ENGINEERING_RULE_PLANNER_DECISION",
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
  agentStarted: "AGENT_STARTED",
  agentCompleted: "AGENT_COMPLETED",
  agentFailed: "AGENT_FAILED",
  subagentSelected: "SUBAGENT_SELECTED",
  modelContentDelta: "MODEL_CONTENT_DELTA",
  modelReasoningDelta: "MODEL_REASONING_DELTA",
  modelRequest: "MODEL_REQUEST",
  modelResult: "MODEL_RESULT",
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

export const ASSESSMENT_RUNTIME_ENGINEERING_PROGRESS_TOOL_NAMES = {
  plannerSummary: "engineering_rule_plan_summary",
  investigatorSummary: "engineering_rule_investigation_summary",
} as const;

export const ASSESSMENT_RUNTIME_ENGINEERING_RULE_TOOL_PREFIXES = {
  planner: "engineering_rule_plan:",
  investigator: "engineering_rule_investigation:",
} as const;

export type AssessmentRuntimeEngineeringProgress = {
  assessmentId: string;
  runId: string;
  planningBatchId: string;
  contextRevisionUsed: number | null;
  targeted: boolean;
  approximate: boolean;
  planner: {
    candidateCount: number;
    selectedCount: number;
    skippedCount: number;
  };
  investigator: {
    selectedCount: number;
    completedCount: number;
    domainLimitedCount: number;
    limitedOrFailedCount: number;
    waitingForInputCount: number;
    runtimeFailedCount: number;
    pendingCount: number;
  };
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
  engineeringProgress: AssessmentRuntimeEngineeringProgress[];
  repositorySnapshots: unknown[];
  scanJobs: unknown[];
  evidenceReports: unknown[];
  postFindingStates: AssessmentPostFindingRuntimeState[];
};
