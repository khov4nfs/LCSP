import { Injectable, Logger } from "@nestjs/common";
import {
  AUDIT_ACTOR_IDS,
  AUDIT_ACTOR_TYPES,
  AUDIT_RESOURCE_TYPES,
  type AuditActorType,
  type AuditDecision,
} from "@lcsp/contracts/audit";
import {
  INTERVIEW_AUDIT_EVENT_TYPES,
  type InterviewAuditActorRef,
  type InterviewAuditEventType,
  type InterviewSourceSnapshotRef,
} from "@lcsp/contracts/audit";
import type {
  AssessmentInterviewAnswerAction,
  AssessmentInterviewControl,
  AssessmentInterviewOutcome,
  AssessmentInterviewQuestionIntent,
} from "@lcsp/contracts/evidence";
import type { Prisma } from "@prisma/client";

import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";

/**
 * Input structure for recording a material customer context statement.
 */
export type RecordStatementAuditInput = {
  assessmentId: string;
  respondentRef: InterviewAuditActorRef;
  interviewContextRevision: string;
  sessionId: string;
  threadId: string;
  turnId: string | number;
  statementKey: string;
  statementValue: unknown;
  questionId?: string;
  questionIntent?: AssessmentInterviewQuestionIntent;
  interpretation?: string;
  evidenceRefs?: string[];
  sourceSnapshot: InterviewSourceSnapshotRef;
  runId?: string;
  stage?: string;
  guidanceVersion?: string;
  modelId?: string;
  correlationId: string;
  causationId?: string | null;
  decision?: AuditDecision | null;
};

/**
 * Input structure for recording explicit statement confirmation by an authenticated actor.
 */
export type RecordConfirmationAuditInput = RecordStatementAuditInput;

/**
 * Input structure for recording a dynamic or seeded question persistence.
 */
export type RecordQuestionPersistedAuditInput = {
  assessmentId: string;
  questionId: string;
  questionIntent: AssessmentInterviewQuestionIntent;
  prompt: string;
  control?: string;
  choices?: unknown[];
  whyEvidenceRefs?: string[];
  sessionId?: string;
  threadId?: string;
  turnId?: string | number;
  sourceSnapshot?: InterviewSourceSnapshotRef;
  runId?: string;
  stage?: string;
  guidanceVersion?: string;
  modelId?: string;
  correlationId: string;
  causationId?: string | null;
};

/**
 * Input structure for recording an authenticated customer's raw or structured answer.
 */
export type RecordCustomerAnswerAuditInput = {
  assessmentId: string;
  respondentRef: InterviewAuditActorRef;
  questionId: string;
  questionIntent?: AssessmentInterviewQuestionIntent;
  responseMode?: AssessmentInterviewControl;
  responseAction?: AssessmentInterviewAnswerAction;
  answerValue: unknown;
  interviewContextRevision: string;
  sessionId?: string;
  threadId?: string;
  turnId?: string | number;
  sourceSnapshot: InterviewSourceSnapshotRef;
  evidenceRefs?: string[];
  correlationId: string;
  causationId?: string | null;
};

/**
 * Input structure for recording a newly committed context revision in the interview state.
 */
export type RecordContextRevisionCreatedAuditInput = {
  assessmentId: string;
  respondentRef?: InterviewAuditActorRef | null;
  contextRevision: string | number;
  priorRevision?: string | number;
  authority?: string;
  statementKey?: string;
  statementValue?: unknown;
  sessionId?: string;
  threadId?: string;
  turnId?: string | number;
  sourceSnapshot: InterviewSourceSnapshotRef;
  governedEvidenceRefs?: string[];
  correlationId: string;
  causationId?: string | null;
};

/**
 * Input structure for recording an interview lifecycle outcome.
 */
export type RecordInterviewOutcomeAuditInput = {
  assessmentId: string;
  outcome: AssessmentInterviewOutcome;
  respondentRef?: InterviewAuditActorRef | null;
  summary?: string;
  activeQuestionId?: string;
  contextRevision?: string | number;
  sessionId?: string;
  threadId?: string;
  guidanceVersion?: string;
  correlationId: string;
  causationId?: string | null;
};

/**
 * Input structure for recording a context supersession (correction / revision update).
 */
export type RecordSupersessionAuditInput = {
  assessmentId: string;
  respondentRef: InterviewAuditActorRef;
  priorRevision: string;
  newRevision: string;
  statementKey: string;
  priorValue: unknown;
  newValue: unknown;
  sessionId: string;
  threadId: string;
  turnId: string | number;
  questionId?: string;
  questionIntent?: AssessmentInterviewQuestionIntent;
  interpretation?: string;
  evidenceRefs?: string[];
  sourceSnapshot: InterviewSourceSnapshotRef;
  runId?: string;
  stage?: string;
  guidanceVersion?: string;
  modelId?: string;
  correlationId: string;
  causationId?: string | null;
};

/**
 * Input structure for recording cross-respondent context contradictions (conflicts).
 */
export type RecordCrossRespondentConflictAuditInput = {
  assessmentId: string;
  statementKey: string;
  firstRespondentRef: InterviewAuditActorRef;
  firstStatementValue: unknown;
  firstTurnId: string | number;
  secondRespondentRef: InterviewAuditActorRef;
  secondStatementValue: unknown;
  secondTurnId: string | number;
  interviewContextRevision: string;
  sessionId: string;
  threadId: string;
  questionId?: string;
  evidenceRefs?: string[];
  sourceSnapshot?: InterviewSourceSnapshotRef;
  runId?: string;
  stage?: string;
  guidanceVersion?: string;
  modelId?: string;
  correlationId: string;
  causationId?: string | null;
};

/**
 * Input structure for recording a targeted clarification loop initiation.
 */
export type RecordTargetedClarificationAuditInput = {
  assessmentId: string;
  respondentRef?: InterviewAuditActorRef | null;
  originatingInvestigationReference: string;
  interviewContextRevision: string;
  sessionId: string;
  threadId: string;
  runId: string;
  stage: string;
  guidanceVersion?: string;
  modelId?: string;
  sourceSnapshot?: InterviewSourceSnapshotRef;
  correlationId: string;
  causationId?: string | null;
};

/**
 * Input structure for recording DOWNSTREAM_IMPACT signal emission by the Interview Agent.
 */
export type RecordDownstreamImpactAuditInput = {
  assessmentId: string;
  respondentRef?: InterviewAuditActorRef | null;
  interviewContextRevision: string;
  affectedActivities?: string[];
  summary?: string;
  sessionId: string;
  threadId: string;
  runId: string;
  stage?: string;
  guidanceVersion?: string;
  modelId?: string;
  sourceSnapshot?: InterviewSourceSnapshotRef;
  correlationId: string;
  causationId?: string | null;
};

/**
 * Input structure for recording Orchestration-owned selective rerun execution.
 */
export type RecordOrchestrationRerunAuditInput = {
  assessmentId: string;
  actorId?: string | null;
  interviewContextRevision: string;
  rerunScope: string[];
  summary: string;
  runId: string;
  sessionId?: string;
  threadId?: string;
  stage?: string;
  guidanceVersion?: string;
  modelId?: string;
  sourceSnapshot?: InterviewSourceSnapshotRef;
  correlationId: string;
  causationId?: string | null;
};

/**
 * High-level domain audit service for Interview Agent operations.
 */
@Injectable()
export class InterviewAuditService {
  private readonly logger = new Logger(InterviewAuditService.name);

  constructor(private readonly auditWriter: AuditWriterService) {}

  /**
   * Records a dynamic or seeded question persistence in the interview audit trail.
   */
  async recordQuestionPersisted(
    input: RecordQuestionPersistedAuditInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.writeInterviewEvent({
      eventType: INTERVIEW_AUDIT_EVENT_TYPES.questionPersisted,
      assessmentId: input.assessmentId,
      actor: this.serviceActor(AUDIT_ACTOR_IDS.interviewAgent),
      correlationId: input.correlationId,
      causationId: input.causationId,
      sessionId: input.sessionId,
      payload: {
        questionId: input.questionId,
        questionIntent: input.questionIntent,
        prompt: input.prompt,
        control: input.control,
        choices: input.choices,
        whyEvidenceRefs: input.whyEvidenceRefs ?? [],
        threadId: input.threadId,
        turnId: input.turnId,
        sourceSnapshot: input.sourceSnapshot,
        runId: input.runId,
        stage: input.stage,
        guidanceVersion: input.guidanceVersion,
        modelId: input.modelId,
      },
      tx,
    });
  }

  /**
   * Records an authenticated customer's submitted answer in the interview audit trail.
   */
  async recordCustomerAnswer(
    input: RecordCustomerAnswerAuditInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const actor = this.authenticatedRespondent(input.respondentRef);
    await this.writeInterviewEvent({
      eventType: INTERVIEW_AUDIT_EVENT_TYPES.customerAnswerRecorded,
      assessmentId: input.assessmentId,
      actor,
      respondentRef: input.respondentRef,
      correlationId: input.correlationId,
      causationId: input.causationId,
      sessionId: input.sessionId,
      payload: {
        questionId: input.questionId,
        questionIntent: input.questionIntent,
        responseMode: input.responseMode,
        responseAction: input.responseAction,
        answerValue: input.answerValue,
        interviewContextRevision: input.interviewContextRevision,
        threadId: input.threadId,
        turnId: input.turnId,
        sourceSnapshot: input.sourceSnapshot,
        evidenceRefs: input.evidenceRefs ?? [],
      },
      tx,
    });
  }

  /**
   * Records the creation/mutation of an interview context revision.
   */
  async recordContextRevisionCreated(
    input: RecordContextRevisionCreatedAuditInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const respondentRef = this.optionalAuthenticatedRespondent(
      input.respondentRef,
    );
    const actor = respondentRef
      ? this.authenticatedRespondent(respondentRef)
      : this.serviceActor(AUDIT_ACTOR_IDS.interviewAgent);

    await this.writeInterviewEvent({
      eventType: INTERVIEW_AUDIT_EVENT_TYPES.contextRevisionCreated,
      assessmentId: input.assessmentId,
      actor,
      respondentRef,
      correlationId: input.correlationId,
      causationId: input.causationId,
      sessionId: input.sessionId,
      payload: {
        contextRevision: String(input.contextRevision),
        priorRevision:
          input.priorRevision !== undefined
            ? String(input.priorRevision)
            : undefined,
        authority: input.authority,
        statementKey: input.statementKey,
        statementValue: input.statementValue,
        threadId: input.threadId,
        turnId: input.turnId,
        sourceSnapshot: input.sourceSnapshot,
        evidenceRefs: input.governedEvidenceRefs ?? [],
      },
      tx,
    });
  }

  /**
   * Records an interview outcome transition (e.g. WAITING_FOR_CUSTOMER, CONTEXT_READY, BLOCKED_OR_UNRESOLVED).
   */
  async recordInterviewOutcome(
    input: RecordInterviewOutcomeAuditInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const respondentRef = this.optionalAuthenticatedRespondent(
      input.respondentRef,
    );
    await this.writeInterviewEvent({
      eventType: INTERVIEW_AUDIT_EVENT_TYPES.interviewOutcomeRecorded,
      assessmentId: input.assessmentId,
      actor: this.serviceActor(AUDIT_ACTOR_IDS.interviewAgent),
      respondentRef,
      correlationId: input.correlationId,
      causationId: input.causationId,
      sessionId: input.sessionId,
      payload: {
        outcome: input.outcome,
        summary: input.summary,
        activeQuestionId: input.activeQuestionId,
        contextRevision:
          input.contextRevision !== undefined
            ? String(input.contextRevision)
            : undefined,
        threadId: input.threadId,
        guidanceVersion: input.guidanceVersion,
      },
      tx,
    });
  }

  /**
   * Records a material Customer context statement in the canonical audit log.
   */
  async recordStatement(
    input: RecordStatementAuditInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const actor = this.authenticatedRespondent(input.respondentRef);
    await this.writeInterviewEvent({
      eventType: INTERVIEW_AUDIT_EVENT_TYPES.statementRecorded,
      assessmentId: input.assessmentId,
      actor,
      respondentRef: input.respondentRef,
      correlationId: input.correlationId,
      causationId: input.causationId,
      decision: input.decision,
      sessionId: input.sessionId,
      payload: {
        statementKey: input.statementKey,
        statementValue: input.statementValue,
        interviewContextRevision: input.interviewContextRevision,
        threadId: input.threadId,
        turnId: input.turnId,
        questionId: input.questionId,
        questionIntent: input.questionIntent,
        interpretation: input.interpretation,
        evidenceRefs: input.evidenceRefs ?? [],
        sourceSnapshot: input.sourceSnapshot,
        runId: input.runId,
        stage: input.stage,
        guidanceVersion: input.guidanceVersion,
        modelId: input.modelId,
      },
      tx,
    });
  }

  /**
   * Records an explicit confirmation of a material statement by an authenticated respondent.
   */
  async recordConfirmation(
    input: RecordConfirmationAuditInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const actor = this.authenticatedRespondent(input.respondentRef);
    await this.writeInterviewEvent({
      eventType: INTERVIEW_AUDIT_EVENT_TYPES.statementConfirmed,
      assessmentId: input.assessmentId,
      actor,
      respondentRef: input.respondentRef,
      correlationId: input.correlationId,
      causationId: input.causationId,
      decision: input.decision,
      sessionId: input.sessionId,
      payload: {
        statementKey: input.statementKey,
        statementValue: input.statementValue,
        interviewContextRevision: input.interviewContextRevision,
        threadId: input.threadId,
        turnId: input.turnId,
        questionId: input.questionId,
        questionIntent: input.questionIntent,
        interpretation: input.interpretation,
        evidenceRefs: input.evidenceRefs ?? [],
        sourceSnapshot: input.sourceSnapshot,
        runId: input.runId,
        stage: input.stage,
        guidanceVersion: input.guidanceVersion,
        modelId: input.modelId,
      },
      tx,
    });
  }

  /**
   * Records a context supersession where an existing context value is corrected or updated.
   */
  async recordSupersession(
    input: RecordSupersessionAuditInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const actor = this.authenticatedRespondent(input.respondentRef);
    await this.writeInterviewEvent({
      eventType: INTERVIEW_AUDIT_EVENT_TYPES.contextSuperseded,
      assessmentId: input.assessmentId,
      actor,
      respondentRef: input.respondentRef,
      correlationId: input.correlationId,
      causationId: input.causationId,
      sessionId: input.sessionId,
      payload: {
        statementKey: input.statementKey,
        priorValue: input.priorValue,
        priorRevision: input.priorRevision,
        newValue: input.newValue,
        newRevision: input.newRevision,
        threadId: input.threadId,
        turnId: input.turnId,
        questionId: input.questionId,
        questionIntent: input.questionIntent,
        interpretation: input.interpretation,
        evidenceRefs: input.evidenceRefs ?? [],
        sourceSnapshot: input.sourceSnapshot,
        runId: input.runId,
        stage: input.stage,
        guidanceVersion: input.guidanceVersion,
        modelId: input.modelId,
      },
      tx,
    });
  }

  /**
   * Records a cross-respondent conflict when two different authenticated users provide conflicting statements.
   */
  async recordCrossRespondentConflict(
    input: RecordCrossRespondentConflictAuditInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const actor = this.authenticatedRespondent(input.secondRespondentRef);
    this.authenticatedRespondent(input.firstRespondentRef);
    await this.writeInterviewEvent({
      eventType: INTERVIEW_AUDIT_EVENT_TYPES.contextConflicted,
      assessmentId: input.assessmentId,
      actor,
      respondentRef: input.secondRespondentRef,
      correlationId: input.correlationId,
      causationId: input.causationId,
      sessionId: input.sessionId,
      payload: {
        statementKey: input.statementKey,
        interviewContextRevision: input.interviewContextRevision,
        threadId: input.threadId,
        questionId: input.questionId,
        evidenceRefs: input.evidenceRefs ?? [],
        sourceSnapshot: input.sourceSnapshot,
        runId: input.runId,
        stage: input.stage,
        guidanceVersion: input.guidanceVersion,
        modelId: input.modelId,
        conflict: {
          firstRespondent: input.firstRespondentRef,
          firstValue: input.firstStatementValue,
          firstTurnId: input.firstTurnId,
          secondRespondent: input.secondRespondentRef,
          secondValue: input.secondStatementValue,
          secondTurnId: input.secondTurnId,
        },
      },
      tx,
    });
  }

  /**
   * Records the initiation of a targeted clarification loop triggered by the Investigator.
   */
  async recordTargetedClarification(
    input: RecordTargetedClarificationAuditInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const respondentRef = this.optionalAuthenticatedRespondent(
      input.respondentRef,
    );
    await this.writeInterviewEvent({
      eventType: INTERVIEW_AUDIT_EVENT_TYPES.targetedClarificationStarted,
      assessmentId: input.assessmentId,
      actor: this.serviceActor(AUDIT_ACTOR_IDS.assessmentOrchestrator),
      respondentRef,
      correlationId: input.correlationId,
      causationId: input.causationId,
      sessionId: input.sessionId,
      payload: {
        originatingInvestigationReference:
          input.originatingInvestigationReference,
        interviewContextRevision: input.interviewContextRevision,
        threadId: input.threadId,
        runId: input.runId,
        stage: input.stage,
        guidanceVersion: input.guidanceVersion,
        modelId: input.modelId,
        sourceSnapshot: input.sourceSnapshot,
      },
      tx,
    });
  }

  /**
   * Records DOWNSTREAM_IMPACT emission from the Interview Agent.
   */
  async recordDownstreamImpact(
    input: RecordDownstreamImpactAuditInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const respondentRef = this.optionalAuthenticatedRespondent(
      input.respondentRef,
    );
    await this.writeInterviewEvent({
      eventType: INTERVIEW_AUDIT_EVENT_TYPES.downstreamImpactEmitted,
      assessmentId: input.assessmentId,
      actor: this.serviceActor(AUDIT_ACTOR_IDS.interviewAgent),
      respondentRef,
      correlationId: input.correlationId,
      causationId: input.causationId,
      sessionId: input.sessionId,
      payload: {
        interviewContextRevision: input.interviewContextRevision,
        affectedActivities: input.affectedActivities,
        summary: input.summary,
        threadId: input.threadId,
        runId: input.runId,
        stage: input.stage,
        guidanceVersion: input.guidanceVersion,
        modelId: input.modelId,
        sourceSnapshot: input.sourceSnapshot,
      },
      tx,
    });
  }

  /**
   * Records an Orchestration-owned selective rerun execution.
   */
  async recordOrchestrationRerun(
    input: RecordOrchestrationRerunAuditInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.writeInterviewEvent({
      eventType: INTERVIEW_AUDIT_EVENT_TYPES.orchestrationRerunTriggered,
      assessmentId: input.assessmentId,
      actor: this.serviceActor(
        input.actorId ?? AUDIT_ACTOR_IDS.assessmentOrchestrator,
      ),
      correlationId: input.correlationId,
      causationId: input.causationId,
      sessionId: input.sessionId,
      payload: {
        interviewContextRevision: input.interviewContextRevision,
        rerunScope: input.rerunScope,
        summary: input.summary,
        runId: input.runId,
        threadId: input.threadId,
        stage: input.stage,
        guidanceVersion: input.guidanceVersion,
        modelId: input.modelId,
        sourceSnapshot: input.sourceSnapshot,
      },
      tx,
    });
  }

  private authenticatedRespondent(
    input: InterviewAuditActorRef,
  ): InterviewAuditEventActor {
    if (!input.id.trim() || input.authenticated !== true) {
      throw new TypeError(
        "Interview audit respondent must come from authenticated runtime context",
      );
    }
    return {
      id: input.id,
      type: AUDIT_ACTOR_TYPES.user,
      role: input.role,
      name: input.name,
      authenticated: true,
    };
  }

  private optionalAuthenticatedRespondent(
    input: InterviewAuditActorRef | null | undefined,
  ): InterviewAuditActorRef | undefined {
    if (!input) return undefined;
    this.authenticatedRespondent(input);
    return input;
  }

  private serviceActor(id: string): InterviewAuditEventActor {
    const actorId = id.trim();
    if (!actorId) {
      throw new TypeError("Interview audit service actor id must not be empty");
    }
    return {
      id: actorId,
      type: AUDIT_ACTOR_TYPES.service,
      authenticated: false,
    };
  }

  /**
   * Internal helper that translates interview domain audit parameters into platform AuditEventInput.
   */
  private async writeInterviewEvent(params: {
    eventType: InterviewAuditEventType;
    assessmentId: string;
    actor: InterviewAuditEventActor;
    respondentRef?: InterviewAuditActorRef;
    correlationId: string;
    causationId?: string | null;
    sessionId?: string | null;
    decision?: AuditDecision | null;
    payload: Record<string, unknown>;
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    const actorId = params.actor.id;
    const eventInput = {
      eventType: params.eventType,
      actorId,
      actor: params.actor,
      assessmentId: params.assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.assessment,
      resourceId: params.assessmentId,
      correlationId: params.correlationId,
      causationId: params.causationId ?? null,
      sessionId:
        params.sessionId ??
        (params.payload.threadId as string | undefined) ??
        null,
      decision: params.decision ?? null,
      result: params.eventType,
      payload: {
        ...params.payload,
        ...(params.respondentRef
          ? { respondentRef: params.respondentRef }
          : {}),
      },
    };

    try {
      if (params.tx) {
        await this.auditWriter.writeInTx(eventInput, params.tx);
      } else {
        await this.auditWriter.write(eventInput);
      }
    } catch (error) {
      this.logger.error(
        `Failed to record interview audit event ${params.eventType} for assessment ${params.assessmentId}: ${(error as Error).message}`,
      );
      throw error;
    }
  }
}

type InterviewAuditEventActor = {
  id: string | null;
  type: AuditActorType;
  role?: string;
  name?: string;
  authenticated: boolean;
};
