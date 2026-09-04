import type {
  AssessmentInterviewAnswerAction,
  AssessmentInterviewControl,
  AssessmentInterviewOutcome,
  AssessmentInterviewQuestionIntent,
} from "../evidence/assessment-interview.ts";
import type { AuditActorType } from "./audit-event.types.ts";

/**
 * Canonical audit event types emitted by the Interview Agent and related runtime components.
 *
 * Sourced strictly from @lcsp/contracts in SCREAMING_SNAKE_CASE format.
 *
 * - INTERVIEW_QUESTION_PERSISTED: A dynamic or seeded interview question was persisted.
 * - INTERVIEW_CUSTOMER_ANSWER_RECORDED: A customer submitted an answer to an active interview question.
 * - INTERVIEW_CONTEXT_REVISION_CREATED: A new interview context revision was created or updated.
 * - INTERVIEW_OUTCOME_RECORDED: An interview lifecycle outcome (e.g. WAITING_FOR_CUSTOMER, CONTEXT_READY, BLOCKED_OR_UNRESOLVED) was recorded.
 * - INTERVIEW_STATEMENT_RECORDED: A new material context statement has been recorded.
 * - INTERVIEW_STATEMENT_CONFIRMED: A material statement has been explicitly confirmed by an authenticated respondent.
 * - INTERVIEW_CONTEXT_SUPERSEDED: An existing context value has been updated/corrected with supersession history.
 * - INTERVIEW_CONTEXT_CONFLICT_RECORDED: A contradiction across respondents has been preserved as a conflict.
 * - INTERVIEW_TARGETED_CLARIFICATION_STARTED: A targeted clarification loop has begun with an originating investigation ref.
 * - INTERVIEW_DOWNSTREAM_IMPACT_EMITTED: Interview engine signaled that context updates impact downstream review.
 * - INTERVIEW_ORCHESTRATION_RERUN_TRIGGERED: Assessment Orchestration executed a selective rerun based on downstream impact.
 */
export const INTERVIEW_AUDIT_EVENT_TYPES = {
  questionPersisted: "INTERVIEW_QUESTION_PERSISTED",
  customerAnswerRecorded: "INTERVIEW_CUSTOMER_ANSWER_RECORDED",
  contextRevisionCreated: "INTERVIEW_CONTEXT_REVISION_CREATED",
  interviewOutcomeRecorded: "INTERVIEW_OUTCOME_RECORDED",
  statementRecorded: "INTERVIEW_STATEMENT_RECORDED",
  statementConfirmed: "INTERVIEW_STATEMENT_CONFIRMED",
  contextSuperseded: "INTERVIEW_CONTEXT_SUPERSEDED",
  contextConflicted: "INTERVIEW_CONTEXT_CONFLICT_RECORDED",
  targetedClarificationStarted: "INTERVIEW_TARGETED_CLARIFICATION_STARTED",
  downstreamImpactEmitted: "INTERVIEW_DOWNSTREAM_IMPACT_EMITTED",
  orchestrationRerunTriggered: "INTERVIEW_ORCHESTRATION_RERUN_TRIGGERED",
} as const;

export type InterviewAuditEventType =
  (typeof INTERVIEW_AUDIT_EVENT_TYPES)[keyof typeof INTERVIEW_AUDIT_EVENT_TYPES];

/**
 * Authenticated actor / respondent reference for material context provenance.
 *
 * Invariant: Must strictly be populated from trusted auth/session tokens,
 * never parsed from message/chat text (e.g., "I am the PO").
 */
export type InterviewAuditActorRef = {
  /** Authenticated user identifier. */
  id: string;
  /** Authenticated user role at the time of the event (e.g., "CUSTOMER", "ADMIN"). */
  role?: string;
  /** Display name if available from session profile. */
  name?: string;
  /** Explicit indicator confirming trusted authentication source. */
  authenticated: true;
};

export const INTERVIEW_TECHNICAL_COVERAGE_STATES = {
  ready: "READY",
  partial: "PARTIAL",
  unavailable: "UNAVAILABLE",
} as const;

export type InterviewTechnicalCoverageState =
  (typeof INTERVIEW_TECHNICAL_COVERAGE_STATES)[keyof typeof INTERVIEW_TECHNICAL_COVERAGE_STATES];

/**
 * Technical snapshot reference identifying the code analysis and guidance state at the time of context recording.
 */
export type InterviewSourceSnapshotRef = {
  /** Repository snapshot ID pinned for the assessment. */
  snapshotId?: string;
  /** Pinned git commit SHA. */
  commitSha?: string;
  /** Rule guidance version active during the turn. */
  guidanceVersion?: string;
  /** Program Graph Engine version used for code analysis. */
  pgeVersion?: string;
  /** Source/repository version label when distinct from the commit SHA. */
  sourceVersion?: string;
  /** Scanner/PGE coverage state pinned for this Interview activity. */
  technicalCoverageState?: InterviewTechnicalCoverageState;
  /** Coverage limitations active when the event was recorded. */
  coverageLimitations?: string[];
};

/**
 * Comprehensive provenance record for a material Customer context statement or confirmation.
 */
export type MaterialCustomerContextProvenance = {
  /** Target assessment identifier. */
  assessmentId: string;
  /** Authenticated actor who made or confirmed the statement. */
  respondentRef: InterviewAuditActorRef;
  /** Monotonically increasing revision identifier for the interview context. */
  interviewContextRevision: string;
  /** Active interview session identifier. */
  sessionId: string;
  /** Interview chat thread identifier. */
  threadId: string;
  /** Specific chat turn identifier or sequence number. */
  turnId: string | number;
  /** Context field identifier (e.g., "business_process", "data_sensitivity"). */
  statementKey: string;
  /** Authoritative context value recorded. */
  statementValue: unknown;
  /** Previous value before supersession, if applicable. */
  priorValue?: unknown;
  /** Previous context revision before supersession, if applicable. */
  priorRevision?: string;
  /** Active dynamic question ID if this statement answered a question. */
  questionId?: string;
  /** Dynamic question intent (ASK | CLARIFY). */
  questionIntent?: AssessmentInterviewQuestionIntent;
  /** Agent interpretation summary confirmed by customer. */
  interpretation?: string;
  /** List of governed evidence IDs supporting or cited in this context item. */
  evidenceRefs?: string[];
  /** Technical source/PGE snapshot metadata (mandatory for material customer context). */
  sourceSnapshot: InterviewSourceSnapshotRef;
  /** ISO timestamp when the event occurred. */
  timestamp: string;
};

/**
 * Runtime correlation context linking Interview audit events with assessment runs and investigations.
 */
export type InterviewRuntimeEventCorrelation = {
  assessmentId: string;
  sessionId: string;
  threadId: string;
  runId: string;
  guidanceVersion?: string;
  interviewContextRevision: string;
  modelId?: string;
  currentStage: string;
  /** Originating investigation ref when targeted clarification is triggered. */
  originatingInvestigationReference?: string | null;
  downstreamImpact?: boolean;
  rerunScope?: string[];
  sourceSnapshot?: InterviewSourceSnapshotRef;
};

/**
 * Preserved detail for a cross-respondent contradiction.
 */
export type InterviewAuditConflictDetail = {
  firstRespondentRef: InterviewAuditActorRef;
  firstStatementValue: unknown;
  firstTurnId: string | number;
  secondRespondentRef: InterviewAuditActorRef;
  secondStatementValue: unknown;
  secondTurnId: string | number;
};

/**
 * Audit trail entry returned by interview audit queries.
 */
export type InterviewAuditTrailItem = {
  id: string;
  eventType: InterviewAuditEventType;
  actorId: string | null;
  actorType: AuditActorType;
  actorRole: string | null;
  actorName: string | null;
  respondentRef?: InterviewAuditActorRef;
  assessmentId: string;
  interviewContextRevision: string | null;
  correlationId: string;
  sessionId: string | null;
  threadId?: string;
  turnId?: string | number;
  runId?: string;
  guidanceVersion?: string;
  modelId?: string;
  currentStage?: string;
  sourceSnapshot?: InterviewSourceSnapshotRef;
  statementKey?: string;
  statementValue?: unknown;
  priorValue?: unknown;
  priorRevision?: string;
  isConflict: boolean;
  conflict?: InterviewAuditConflictDetail;
  questionId?: string;
  questionIntent?: AssessmentInterviewQuestionIntent;
  responseMode?: AssessmentInterviewControl;
  responseAction?: AssessmentInterviewAnswerAction;
  outcome?: AssessmentInterviewOutcome;
  interpretation?: string;
  evidenceRefs: string[];
  originatingInvestigationReference?: string | null;
  downstreamImpact?: boolean;
  affectedActivities: string[];
  rerunScope: string[];
  occurredAt: string;
};

/**
 * Paginated response structure for assessment interview audit queries.
 */
export type InterviewAuditTrailResponse = {
  assessmentId: string;
  events: InterviewAuditTrailItem[];
  total: number;
  limit?: number;
  offset?: number;
};
