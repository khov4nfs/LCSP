import {
  ASSESSMENT_FACT_KINDS,
  type AssessmentDetail,
  type AssessmentHumanRequestView,
} from "@lcsp/contracts/assessment-domain";
import {
  ASSESSMENT_LIFECYCLE_STATES,
  type AssessmentEvent,
} from "@lcsp/contracts/assessment";

export const CONVERSATION_TURN_KINDS = {
  OPENING: "OPENING",
  WORK: "WORK",
  QUESTION: "QUESTION",
  ANSWER: "ANSWER",
  DECISION: "DECISION",
  NOTICE: "NOTICE",
  COMPLETION: "COMPLETION",
} as const;
export type ConversationTurnKind =
  (typeof CONVERSATION_TURN_KINDS)[keyof typeof CONVERSATION_TURN_KINDS];

export const CONVERSATION_NOTICE_KINDS = {
  PAUSED: ASSESSMENT_LIFECYCLE_STATES.PAUSED,
  RESUMED: "RESUMED",
  FINALIZING: ASSESSMENT_LIFECYCLE_STATES.FINALIZING,
  BLOCKED: ASSESSMENT_LIFECYCLE_STATES.BLOCKED,
  FAILED: ASSESSMENT_LIFECYCLE_STATES.FAILED,
} as const;
export type ConversationNoticeKind =
  (typeof CONVERSATION_NOTICE_KINDS)[keyof typeof CONVERSATION_NOTICE_KINDS];

export const WORK_STEP_KINDS = {
  FACT: ASSESSMENT_FACT_KINDS.FACT,
  RULE: "RULE",
  RESEARCH: "RESEARCH",
  REASONING: "REASONING",
  INSPECTION: "INSPECTION",
  OTHER: "OTHER",
} as const;
export type WorkStepKind =
  (typeof WORK_STEP_KINDS)[keyof typeof WORK_STEP_KINDS];

/** Whether an activity label opens, closes or alone completes a unit of work. */
export const WORK_STEP_PHASES = {
  START: "START",
  DONE: "DONE",
  SINGLE: "SINGLE",
} as const;
export type WorkStepPhase =
  (typeof WORK_STEP_PHASES)[keyof typeof WORK_STEP_PHASES];

export const WORK_STEP_STATUSES = {
  DONE: "DONE",
  ACTIVE: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
} as const;
export type WorkStepStatus =
  (typeof WORK_STEP_STATUSES)[keyof typeof WORK_STEP_STATUSES];

/** Token totals counted once per model invocation. */
export type UsageTotals = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  invocations: number;
};

export type TechnicalEvent = {
  eventId: string;
  sequence: number;
  timestamp: string;
  eventType: string;
  actorType: string;
  labelKey: string | null;
  executionId: string | null;
  taskId: string | null;
  toolCallId: string | null;
  invocationId: string | null;
  usage: UsageTotals | null;
};

export type WorkStep = {
  kind: WorkStepKind;
  count: number;
  status: WorkStepStatus;
  usage: UsageTotals | null;
};

type TurnBase = { id: string; sequence: number; at: string };

export type OpeningTurn = TurnBase & {
  kind: typeof CONVERSATION_TURN_KINDS.OPENING;
  repositoryFullName: string | null;
  commit: string | null;
  ruleSetVersion: string | null;
};
export type WorkTurn = TurnBase & {
  kind: typeof CONVERSATION_TURN_KINDS.WORK;
  endedAt: string;
  durationMs: number;
  running: boolean;
  steps: WorkStep[];
  usage: UsageTotals | null;
  technical: TechnicalEvent[];
};
export type QuestionTurn = TurnBase & {
  kind: typeof CONVERSATION_TURN_KINDS.QUESTION;
  request: AssessmentHumanRequestView;
  open: boolean;
};
export type AnswerTurn = TurnBase & {
  kind: typeof CONVERSATION_TURN_KINDS.ANSWER;
  requestId: string;
  answer: string | null;
  doesNotKnow: boolean;
};
type DecisionRecord = NonNullable<
  AssessmentDetail["case"]
>["decisions"][number];
export type DecisionTurn = TurnBase & {
  kind: typeof CONVERSATION_TURN_KINDS.DECISION;
  decisionId: string;
  assessmentRuleId: string;
  concept: string | null;
  record: DecisionRecord;
};
export type NoticeTurn = TurnBase & {
  kind: typeof CONVERSATION_TURN_KINDS.NOTICE;
  notice: ConversationNoticeKind;
  blockerReason: string | null;
};
export type CompletionTurn = TurnBase & {
  kind: typeof CONVERSATION_TURN_KINDS.COMPLETION;
  assessmentId: string;
  evaluated: number;
  compliant: number;
  nonCompliant: number;
  notApplicable: number;
  reportArtifactId: string | null;
};

export type ConversationTurn =
  | OpeningTurn
  | WorkTurn
  | QuestionTurn
  | AnswerTurn
  | DecisionTurn
  | NoticeTurn
  | CompletionTurn;

export type ConversationInput = {
  assessmentId: string;
  events: readonly AssessmentEvent[];
  detail: AssessmentDetail | null;
  requests: readonly AssessmentHumanRequestView[];
  repository: { fullName: string | null; commit: string | null } | null;
};

export type ConversationProjection = {
  turns: ConversationTurn[];
  /** The canonical runtime is executing: only then may the last work turn animate. */
  running: boolean;
  /** The OPEN human request that the next answer belongs to. */
  openRequestId: string | null;
  /** Changes whenever the visible conversation changes; drives follow-the-latest scrolling. */
  followKey: string;
};
