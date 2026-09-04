import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_EVENT_TYPES,
} from "@lcsp/contracts/assessment";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_REDACTION_STATUSES,
} from "@lcsp/contracts/audit";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  ASSESSMENT_CONTEXT_AUTHORITY_STATUSES,
  ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS,
  ASSESSMENT_INTERVIEW_CONTROLS,
  ASSESSMENT_INTERVIEW_OUTCOMES,
  ASSESSMENT_INTERVIEW_QUESTION_INTENTS,
  ASSESSMENT_RUNTIME_STAGE_CODES,
  type AssessmentContextAuthorityStatus,
  type AssessmentInterviewAnswerHistoryItem,
  type AssessmentInterviewAnswerInput,
  type AssessmentInterviewBlockedInput,
  type AssessmentInterviewRuntimeState,
} from "@lcsp/contracts/evidence";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import {
  BadRequestException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import { AssessmentRuntimeEventService } from "../../../../platform/runtime-events/assessment-runtime-event.service.js";
import type { RbacRequestContext } from "../../../../platform/rbac/interfaces/rbac-request.interface.js";

const INTERVIEW_TOOL_NAME = "assessment_interview";
const INTERVIEW_SOURCE_VERSION = "assessment-interview-runtime-v1";
const MISSING_SOURCE_VERSION = "NO_REPOSITORY_SNAPSHOT";
const MISSING_PGE_VERSION = "NO_TECHNICAL_EVIDENCE_REPORT";
const PUBLIC_REDACTED_ANSWER_SUMMARY =
  "Customer answer persisted in governed Interview state.";
const PUBLIC_REDACTED_DRAFT_SUMMARY =
  "Customer draft persisted for Interview resume.";
const INTERVIEW_AGENT_DECISION_REQUIRED = "INTERVIEW_AGENT_DECISION_REQUIRED";

export type PrivateInterviewAnswerRevision = {
  questionId: string;
  answer: AssessmentInterviewAnswerInput;
  actorId: string;
  answeredAt: string;
  contextRevision: number;
  priorRevision: number;
  authority: AssessmentContextAuthorityStatus;
  questionIntent?: NonNullable<
    AssessmentInterviewRuntimeState["activeQuestion"]
  >["intent"];
  questionControl?: NonNullable<
    AssessmentInterviewRuntimeState["activeQuestion"]
  >["control"];
  sourceVersion: string;
  pgeVersion: string;
  governedEvidenceRefs: string[];
  processedAt?: string;
};

type TargetedInterviewNeed = {
  needId: string;
  businessContextNeed: string;
  resolutionCriteria: string[];
  originatingInvestigationReference: string;
  sourceVersion: string;
  pgeVersion: string;
};

type TargetedInterviewContinuation = {
  originatingInvestigationReference: string;
  investigatorExecutionId: string;
  workflowRunId: string;
  checkpointId: string;
  affectedRuleIds: string[];
  artifactVersions: Record<string, string>;
  sourceVersion: string;
  pgeVersion: string;
};

type PrivateInterviewStore = {
  revisions: PrivateInterviewAnswerRevision[];
  targetedNeed?: TargetedInterviewNeed;
  targetedContinuation?: TargetedInterviewContinuation;
};

type TargetedNeedRegistrationInput = {
  actorId: string;
  needId: string;
  businessContextNeed: string;
  resolutionCriteria: string[];
  originatingInvestigationReference: string;
  investigatorExecutionId: string;
  workflowRunId: string;
  checkpointId: string;
  affectedRuleIds: string[];
  artifactVersions: Record<string, string>;
};

type WorkerPrivateContext = {
  status: "CURRENT" | "DUPLICATE" | "STALE" | "STALE_PROVENANCE";
  assessmentId: string;
  threadId: string;
  requestedRevision: number;
  currentRevision: number;
  processedRevision: number;
  sourceVersion: string;
  pgeVersion: string;
  publicState: AssessmentInterviewRuntimeState;
  privateRevision?: PrivateInterviewAnswerRevision;
  targetedNeed?: TargetedInterviewNeed;
};

type AgentDecisionInput = {
  expectedContextRevision: number;
  mode?: "INITIAL_INTERVIEW" | "TARGETED_INTERVIEW";
  outcome: AssessmentInterviewRuntimeState["outcome"];
  activeQuestion?: AssessmentInterviewRuntimeState["activeQuestion"];
  contextAuthority?: AssessmentContextAuthorityStatus;
  confirmedContext?: Record<string, unknown>;
  blockedActions?: AssessmentInterviewRuntimeState["blockedActions"];
  flags?: AssessmentInterviewRuntimeState["flags"];
};

@Injectable()
export class AssessmentInterviewRuntimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runtimeEvents: AssessmentRuntimeEventService,
    private readonly outboxRepository: OutboxRepository,
  ) {}

  async getState(
    assessmentId: string,
    actor: RbacRequestContext,
  ): Promise<AssessmentInterviewRuntimeState> {
    await this.assertAssessmentVisible(assessmentId, actor);
    return publicState((await this.readThread(assessmentId)).state);
  }

  async submitAnswer(input: {
    assessmentId: string;
    actor: RbacRequestContext;
    correlationId: string;
    answer: AssessmentInterviewAnswerInput;
  }): Promise<AssessmentInterviewRuntimeState> {
    const answer = parseAnswer(input.answer);
    await this.assertAssessmentVisible(input.assessmentId, input.actor);
    const now = new Date().toISOString();
    const next = await this.prisma.$transaction(async (tx) => {
      const thread = await this.readThread(input.assessmentId, tx);
      if (
        !thread.state.activeQuestion ||
        thread.state.activeQuestion.id !== answer.questionId ||
        thread.activeQuestionId !== answer.questionId
      ) {
        throw problemException(
          "INTERVIEW_QUESTION_STALE_OR_UNKNOWN",
          input.correlationId,
          {
            status: HttpStatus.CONFLICT,
          },
        );
      }
      assertAnswerMatchesQuestion(answer, thread.state.activeQuestion);
      const priorRevision = thread.contextRevision;
      const nextRevision = priorRevision + 1;
      const provenance = await this.assessmentProvenance(
        input.assessmentId,
        tx,
      );
      const historyItem: AssessmentInterviewAnswerHistoryItem = {
        questionId: answer.questionId,
        actorId: input.actor.userId,
        answeredAt: now,
        summary: summarizeAnswer(answer),
      };
      const privateRevision: PrivateInterviewAnswerRevision = {
        questionId: answer.questionId,
        answer,
        actorId: input.actor.userId,
        answeredAt: now,
        contextRevision: nextRevision,
        priorRevision,
        authority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerStated,
        questionIntent: thread.state.activeQuestion.intent,
        questionControl: thread.state.activeQuestion.control,
        sourceVersion: provenance.sourceVersion,
        pgeVersion: provenance.pgeVersion,
        governedEvidenceRefs: provenance.governedEvidenceRefs,
      };
      const nextState: AssessmentInterviewRuntimeState = {
        ...thread.state,
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
        contextAuthority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerStated,
        contextRevision: nextRevision,
        activeQuestion: undefined,
        pendingDraft: undefined,
        answerHistory: [...(thread.state.answerHistory ?? []), historyItem],
        orchestrationRequested: true,
        audit: this.auditRef(
          input.assessmentId,
          input.actor.userId,
          input.correlationId,
          {
            contextRevision: nextRevision,
            priorRevision,
            newRevision: nextRevision,
            relatedQuestionId: answer.questionId,
            provenance,
          },
        ),
      };
      const updated = await tx.assessmentInterviewThread.updateMany({
        where: {
          assessmentId: input.assessmentId,
          activeQuestionId: answer.questionId,
          contextRevision: priorRevision,
        },
        data: {
          stateJson: toJson(nextState),
          privateContextJson: toJson({
            ...thread.privateStore,
            revisions: [...thread.privateRevisions, privateRevision],
          }),
          contextRevision: nextRevision,
          activeQuestionId: null,
          processedRevision: thread.processedRevision,
          sourceVersion: provenance.sourceVersion,
          pgeVersion: provenance.pgeVersion,
        },
      });
      if (updated.count !== 1) {
        throw problemException(
          "INTERVIEW_QUESTION_STALE_OR_UNKNOWN",
          input.correlationId,
          {
            status: HttpStatus.CONFLICT,
          },
        );
      }
      await this.outboxRepository.enqueue(
        this.interviewAgentResumeCommand({
          assessmentId: input.assessmentId,
          actorId: input.actor.userId,
          correlationId: input.correlationId,
          contextRevision: nextRevision,
          questionId: answer.questionId,
          sourceVersion: provenance.sourceVersion,
          pgeVersion: provenance.pgeVersion,
          resumeReason: INTERVIEW_AGENT_DECISION_REQUIRED,
        }),
        tx,
      );
      return {
        state: nextState,
        revision: nextRevision,
        questionId: answer.questionId,
      };
    });

    await this.runtimeEvents.recordToolWaitingInput({
      assessmentId: input.assessmentId,
      runId: this.threadId(input.assessmentId),
      correlationId: input.correlationId,
      stage: ASSESSMENT_RUNTIME_STAGE_CODES.interview,
      toolName: INTERVIEW_TOOL_NAME,
      summary:
        "Customer interview answer persisted; Interview Agent sufficiency decision required.",
      inputSummary: {
        questionId: next.questionId,
        answer: PUBLIC_REDACTED_ANSWER_SUMMARY,
      },
      outputSummary: { assessmentInterview: publicState(next.state) },
      waitingReason: INTERVIEW_AGENT_DECISION_REQUIRED,
      startedAt: new Date(),
    });
    return next.state;
  }

  async recordBlockedAction(input: {
    assessmentId: string;
    actor: RbacRequestContext;
    correlationId: string;
    blocked: AssessmentInterviewBlockedInput;
  }): Promise<AssessmentInterviewRuntimeState> {
    const blocked = parseBlockedAction(input.blocked);
    await this.assertAssessmentVisible(input.assessmentId, input.actor);
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const current = await this.readThread(input.assessmentId, tx);
      const provenance = await this.assessmentProvenance(
        input.assessmentId,
        tx,
      );
      const shouldResume =
        blocked.action ===
        ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.provideMoreContext;
      const nextState: AssessmentInterviewRuntimeState = {
        ...current.state,
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved,
        threadId: this.threadId(input.assessmentId),
        activeQuestion: undefined,
        blockedActions: Object.values(ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS),
        pendingDraft:
          blocked.action === ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.saveAndExit
            ? (blocked.draft ?? current.state.pendingDraft)
            : current.state.pendingDraft,
        orchestrationRequested: shouldResume,
        audit: this.auditRef(
          input.assessmentId,
          input.actor.userId,
          input.correlationId,
          {
            contextRevision: current.contextRevision,
            provenance,
          },
        ),
      };
      await this.persistThreadState(input.assessmentId, nextState, tx, {
        contextRevision: current.contextRevision,
        activeQuestionId: null,
        processedRevision: current.processedRevision,
        privateStore: current.privateStore,
        sourceVersion: provenance.sourceVersion,
        pgeVersion: provenance.pgeVersion,
      });
      if (shouldResume) {
        await this.outboxRepository.enqueue(
          this.interviewAgentResumeCommand({
            assessmentId: input.assessmentId,
            actorId: input.actor.userId,
            correlationId: input.correlationId,
            contextRevision: current.contextRevision,
            questionId: current.activeQuestionId ?? "PROVIDE_MORE_CONTEXT",
            sourceVersion: provenance.sourceVersion,
            pgeVersion: provenance.pgeVersion,
            resumeReason:
              ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.provideMoreContext,
          }),
          tx,
        );
      }
      return nextState;
    });

    await this.runtimeEvents.recordToolWaitingInput({
      assessmentId: input.assessmentId,
      runId: this.threadId(input.assessmentId),
      correlationId: input.correlationId,
      stage: ASSESSMENT_RUNTIME_STAGE_CODES.interview,
      toolName: INTERVIEW_TOOL_NAME,
      summary: "Customer selected an unresolved Interview action.",
      inputSummary: {
        action: blocked.action,
        draft: blocked.draft ? PUBLIC_REDACTED_DRAFT_SUMMARY : undefined,
      },
      outputSummary: {
        assessmentInterview: publicState({
          ...result,
          pendingDraft: undefined,
        }),
      },
      waitingReason: blocked.action,
      startedAt: now,
    });
    return result;
  }

  async getPrivateContextForWorker(input: {
    assessmentId: string;
    contextRevision: number;
    sourceVersion?: string;
    pgeVersion?: string;
  }): Promise<WorkerPrivateContext> {
    const thread = await this.readThread(input.assessmentId);
    const authoritative = await this.assessmentProvenance(input.assessmentId);
    const privateRevision = thread.privateRevisions.find(
      (revision) => revision.contextRevision === input.contextRevision,
    );
    const target = thread.privateStore.targetedNeed;
    const provenanceChanged =
      (input.sourceVersion &&
        input.sourceVersion !== authoritative.sourceVersion) ||
      (input.pgeVersion && input.pgeVersion !== authoritative.pgeVersion) ||
      thread.sourceVersion !== authoritative.sourceVersion ||
      thread.pgeVersion !== authoritative.pgeVersion ||
      (!!privateRevision &&
        (privateRevision.sourceVersion !== authoritative.sourceVersion ||
          privateRevision.pgeVersion !== authoritative.pgeVersion)) ||
      (!!target &&
        (target.sourceVersion !== authoritative.sourceVersion ||
          target.pgeVersion !== authoritative.pgeVersion));
    const status = provenanceChanged
      ? "STALE_PROVENANCE"
      : thread.processedRevision >= input.contextRevision
        ? "DUPLICATE"
        : thread.contextRevision === input.contextRevision && privateRevision
          ? "CURRENT"
          : "STALE";
    return {
      status,
      assessmentId: input.assessmentId,
      threadId: this.threadId(input.assessmentId),
      requestedRevision: input.contextRevision,
      currentRevision: thread.contextRevision,
      processedRevision: thread.processedRevision,
      sourceVersion: authoritative.sourceVersion,
      pgeVersion: authoritative.pgeVersion,
      publicState: thread.state,
      privateRevision,
      targetedNeed: target,
    };
  }

  async registerTargetedNeedForWorker(input: {
    assessmentId: string;
    correlationId: string;
    target: TargetedNeedRegistrationInput;
  }): Promise<AssessmentInterviewRuntimeState> {
    const target = parseTargetedNeedRegistration(input.target);
    return this.prisma.$transaction(async (tx) => {
      const thread = await this.readThread(input.assessmentId, tx);
      if (thread.state.outcome !== ASSESSMENT_INTERVIEW_OUTCOMES.contextReady) {
        throw problemException(
          "INTERVIEW_TARGETED_NEED_REQUIRES_READY_CONTEXT",
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      const provenance = await this.assessmentProvenance(
        input.assessmentId,
        tx,
      );
      if (
        !thread.sourceVersion ||
        !thread.pgeVersion ||
        thread.sourceVersion !== provenance.sourceVersion ||
        thread.pgeVersion !== provenance.pgeVersion
      ) {
        throw problemException(
          "INTERVIEW_TARGETED_REGISTRATION_STALE_PROVENANCE",
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      const targetedNeed: TargetedInterviewNeed = {
        needId: target.needId,
        businessContextNeed: target.businessContextNeed,
        resolutionCriteria: target.resolutionCriteria,
        originatingInvestigationReference:
          target.originatingInvestigationReference,
        sourceVersion: thread.sourceVersion,
        pgeVersion: thread.pgeVersion,
      };
      const targetedContinuation: TargetedInterviewContinuation = {
        originatingInvestigationReference:
          target.originatingInvestigationReference,
        investigatorExecutionId: target.investigatorExecutionId,
        workflowRunId: target.workflowRunId,
        checkpointId: target.checkpointId,
        affectedRuleIds: target.affectedRuleIds,
        artifactVersions: target.artifactVersions,
        sourceVersion: thread.sourceVersion,
        pgeVersion: thread.pgeVersion,
      };
      const nextState: AssessmentInterviewRuntimeState = {
        ...thread.state,
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
        activeQuestion: undefined,
        orchestrationRequested: true,
      };
      const privateStore: PrivateInterviewStore = {
        ...thread.privateStore,
        targetedNeed,
        targetedContinuation,
      };
      await this.persistThreadState(input.assessmentId, nextState, tx, {
        contextRevision: thread.contextRevision,
        activeQuestionId: null,
        processedRevision: thread.processedRevision,
        privateStore,
        sourceVersion: thread.sourceVersion,
        pgeVersion: thread.pgeVersion,
      });
      await this.outboxRepository.enqueue(
        this.interviewAgentResumeCommand({
          assessmentId: input.assessmentId,
          actorId: target.actorId,
          correlationId: input.correlationId,
          contextRevision: thread.contextRevision,
          questionId: target.needId,
          sourceVersion: thread.sourceVersion,
          pgeVersion: thread.pgeVersion,
          resumeReason: "TARGETED_INTERVIEW_REQUIRED",
        }),
        tx,
      );
      return nextState;
    });
  }

  async getWorkerStateForWorker(
    assessmentId: string,
  ): Promise<AssessmentInterviewRuntimeState> {
    return (await this.readThread(assessmentId)).state;
  }

  async recordAgentDecision(input: {
    assessmentId: string;
    correlationId: string;
    decision: AgentDecisionInput;
  }): Promise<
    AssessmentInterviewRuntimeState & {
      continuation?: TargetedInterviewContinuation;
    }
  > {
    const decision = parseAgentDecision(input.decision);
    const result = await this.prisma.$transaction(async (tx) => {
      const thread = await this.readThread(input.assessmentId, tx);
      if (decision.expectedContextRevision !== thread.contextRevision) {
        throw problemException(
          "INTERVIEW_DECISION_STALE_REVISION",
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      const latestPrivate = thread.privateRevisions.find(
        (revision) =>
          revision.contextRevision === decision.expectedContextRevision,
      );
      const authoritative = await this.assessmentProvenance(
        input.assessmentId,
        tx,
      );
      if (
        thread.sourceVersion !== authoritative.sourceVersion ||
        thread.pgeVersion !== authoritative.pgeVersion ||
        (!!latestPrivate &&
          (latestPrivate.sourceVersion !== authoritative.sourceVersion ||
            latestPrivate.pgeVersion !== authoritative.pgeVersion))
      ) {
        throw problemException(
          "INTERVIEW_DECISION_STALE_PROVENANCE",
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      const isBlockedFollowup =
        thread.state.outcome ===
          ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved &&
        decision.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer;
      const isTargetedBootstrap =
        decision.mode === "TARGETED_INTERVIEW" &&
        decision.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer &&
        thread.state.outcome ===
          ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer &&
        !thread.activeQuestionId &&
        !!thread.privateStore.targetedNeed;
      assertGuardedDecision(
        decision,
        latestPrivate,
        thread,
        input.correlationId,
        { isBlockedFollowup, isTargetedBootstrap },
      );
      const state = decisionState(thread.state, decision);
      const revisions = thread.privateRevisions.map((revision) =>
        revision.contextRevision === decision.expectedContextRevision
          ? {
              ...revision,
              authority: decision.contextAuthority ?? revision.authority,
              processedAt: new Date().toISOString(),
            }
          : revision,
      );
      const updated = await tx.assessmentInterviewThread.updateMany({
        where: {
          assessmentId: input.assessmentId,
          contextRevision: decision.expectedContextRevision,
          activeQuestionId: thread.activeQuestionId,
          processedRevision:
            isBlockedFollowup || isTargetedBootstrap
              ? thread.processedRevision
              : { lt: decision.expectedContextRevision },
        },
        data: {
          stateJson: toJson(state),
          contextRevision: thread.contextRevision,
          activeQuestionId: state.activeQuestion?.id ?? null,
          processedRevision: decision.expectedContextRevision,
          privateContextJson: toJson({
            ...thread.privateStore,
            revisions,
          }),
        },
      });
      if (updated.count !== 1) {
        throw problemException(
          "INTERVIEW_DECISION_ALREADY_PROCESSED",
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      return {
        state,
        continuation:
          decision.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved
            ? thread.privateStore.targetedContinuation
            : undefined,
      };
    });

    await this.runtimeEvents.recordToolWaitingInput({
      assessmentId: input.assessmentId,
      runId: this.threadId(input.assessmentId),
      correlationId: input.correlationId,
      stage: ASSESSMENT_RUNTIME_STAGE_CODES.interview,
      toolName: INTERVIEW_TOOL_NAME,
      summary:
        "Interview Agent guarded decision persisted for customer or orchestration continuation.",
      inputSummary: { decisionOutcome: result.state.outcome },
      outputSummary: { assessmentInterview: runtimeEventState(result.state) },
      waitingReason:
        result.state.outcome ===
        ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer
          ? "WAITING_FOR_CUSTOMER"
          : null,
      startedAt: new Date(),
    });
    return result.continuation
      ? { ...result.state, continuation: result.continuation }
      : result.state;
  }

  async seedInitialQuestionForWorker(input: {
    assessmentId: string;
    correlationId: string;
    state: AssessmentInterviewRuntimeState;
  }): Promise<AssessmentInterviewRuntimeState> {
    const state = parsePublicInterviewState(input.state);
    if (
      !state ||
      state.outcome !== ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer ||
      !state.activeQuestion
    ) {
      throw problemException(
        "INTERVIEW_INITIAL_QUESTION_INVALID",
        input.correlationId,
        {
          status: HttpStatus.BAD_REQUEST,
        },
      );
    }
    const activeQuestionId = state.activeQuestion.id;
    const provenance = await this.assessmentProvenance(input.assessmentId);
    const nextState: AssessmentInterviewRuntimeState = {
      ...state,
      threadId: this.threadId(input.assessmentId),
      contextRevision: state.contextRevision ?? 0,
      orchestrationRequested: false,
    };
    await this.persistThreadState(input.assessmentId, nextState, undefined, {
      contextRevision: nextState.contextRevision ?? 0,
      activeQuestionId,
      processedRevision: 0,
      privateStore: { revisions: [] },
      sourceVersion: provenance.sourceVersion,
      pgeVersion: provenance.pgeVersion,
    });
    await this.runtimeEvents.recordToolWaitingInput({
      assessmentId: input.assessmentId,
      runId: this.threadId(input.assessmentId),
      correlationId: input.correlationId,
      stage: ASSESSMENT_RUNTIME_STAGE_CODES.interview,
      toolName: INTERVIEW_TOOL_NAME,
      summary: "Interview Agent question is waiting for Customer response.",
      outputSummary: { assessmentInterview: publicState(nextState) },
      waitingReason: "WAITING_FOR_CUSTOMER",
      startedAt: new Date(),
    });
    return nextState;
  }

  private async assertAssessmentVisible(
    assessmentId: string,
    actor: RbacRequestContext,
  ): Promise<void> {
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: { id: true, ownerId: true },
    });
    if (!assessment) {
      throw new NotFoundException({ code: ASSESSMENT_ERROR_CODES.notFound });
    }
    if (
      actor.role === AUTH_USER_ROLES.customer &&
      assessment.ownerId !== actor.userId
    ) {
      throw new NotFoundException({ code: ASSESSMENT_ERROR_CODES.notFound });
    }
  }

  private async readThread(
    assessmentId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{
    state: AssessmentInterviewRuntimeState;
    privateStore: PrivateInterviewStore;
    privateRevisions: PrivateInterviewAnswerRevision[];
    contextRevision: number;
    activeQuestionId: string | null;
    processedRevision: number;
    sourceVersion: string | null;
    pgeVersion: string | null;
  }> {
    const client = tx ?? this.prisma;
    const thread = await client.assessmentInterviewThread.findUnique({
      where: { assessmentId },
    });
    const fallbackState: AssessmentInterviewRuntimeState = {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      threadId: this.threadId(assessmentId),
      contextRevision: 0,
      answerHistory: [],
    };
    if (!thread) {
      const privateStore: PrivateInterviewStore = { revisions: [] };
      return {
        state: fallbackState,
        privateStore,
        privateRevisions: privateStore.revisions,
        contextRevision: 0,
        activeQuestionId: null,
        processedRevision: 0,
        sourceVersion: null,
        pgeVersion: null,
      };
    }
    const state = parsePublicInterviewState(thread.stateJson) ?? fallbackState;
    const privateStore = parsePrivateStore(thread.privateContextJson);
    return {
      state,
      privateStore,
      privateRevisions: privateStore.revisions,
      contextRevision: thread.contextRevision,
      activeQuestionId: thread.activeQuestionId,
      processedRevision: thread.processedRevision,
      sourceVersion: thread.sourceVersion,
      pgeVersion: thread.pgeVersion,
    };
  }

  private async persistThreadState(
    assessmentId: string,
    state: AssessmentInterviewRuntimeState,
    tx?: Prisma.TransactionClient,
    input?: {
      contextRevision: number;
      activeQuestionId: string | null;
      processedRevision: number;
      privateStore: PrivateInterviewStore;
      sourceVersion: string;
      pgeVersion: string;
    },
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.assessmentInterviewThread.upsert({
      where: { assessmentId },
      update: {
        stateJson: toJson(state),
        ...(input
          ? {
              privateContextJson: toJson(input.privateStore),
              contextRevision: input.contextRevision,
              activeQuestionId: input.activeQuestionId,
              processedRevision: input.processedRevision,
              sourceVersion: input.sourceVersion,
              pgeVersion: input.pgeVersion,
            }
          : {}),
      },
      create: {
        id: this.threadId(assessmentId),
        assessmentId,
        stateJson: toJson(state),
        privateContextJson: toJson(input?.privateStore ?? { revisions: [] }),
        contextRevision: input?.contextRevision ?? state.contextRevision ?? 0,
        activeQuestionId: input?.activeQuestionId ?? state.activeQuestion?.id,
        processedRevision: input?.processedRevision ?? 0,
        sourceVersion: input?.sourceVersion,
        pgeVersion: input?.pgeVersion,
      },
    });
  }

  private interviewAgentResumeCommand(input: {
    assessmentId: string;
    actorId: string;
    correlationId: string;
    contextRevision: number;
    questionId: string;
    sourceVersion: string;
    pgeVersion: string;
    resumeReason: string;
  }) {
    return buildOutboxMessageInput({
      aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
      aggregateId: input.assessmentId,
      eventType: ASSESSMENT_EVENT_TYPES.interviewAgentResumeRequestedOutbox,
      assessmentId: input.assessmentId,
      correlationId: input.correlationId,
      causationId: input.correlationId,
      actor: { id: input.actorId, type: AUDIT_ACTOR_TYPES.user },
      result: ASSESSMENT_EVENT_TYPES.interviewAnswerSubmitted,
      redactionStatus: AUDIT_REDACTION_STATUSES.redacted,
      idempotencyKey: `${input.assessmentId}:${input.contextRevision}:${input.resumeReason}:${input.questionId}:${ASSESSMENT_EVENT_TYPES.interviewAgentResumeRequestedOutbox}`,
      payload: {
        assessmentId: input.assessmentId,
        threadId: this.threadId(input.assessmentId),
        contextRevision: input.contextRevision,
        questionId: input.questionId,
        sourceVersion: input.sourceVersion,
        pgeVersion: input.pgeVersion,
        resumeReason: input.resumeReason,
      },
    });
  }

  private auditRef(
    assessmentId: string,
    actorId: string,
    correlationId: string,
    input: {
      contextRevision: number;
      priorRevision?: number;
      newRevision?: number;
      relatedQuestionId?: string;
      provenance: {
        sourceVersion: string;
        pgeVersion: string;
        governedEvidenceRefs: string[];
      };
    },
  ) {
    return {
      authenticatedActorId: actorId,
      timestamp: new Date().toISOString(),
      assessmentId,
      sourceVersion: input.provenance.sourceVersion,
      pgeVersion: input.provenance.pgeVersion,
      sessionId: this.threadId(assessmentId),
      turnId: correlationId,
      governedEvidenceRefs: input.provenance.governedEvidenceRefs,
      contextRevision: input.contextRevision,
      priorRevision: input.priorRevision,
      newRevision: input.newRevision,
      relatedQuestionId: input.relatedQuestionId,
    };
  }

  private async assessmentProvenance(
    assessmentId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{
    sourceVersion: string;
    pgeVersion: string;
    governedEvidenceRefs: string[];
  }> {
    const client = tx ?? this.prisma;
    const [snapshot, report] = await Promise.all([
      client.repositorySnapshot.findFirst({
        where: { assessmentId },
        orderBy: { createdAt: "desc" },
        select: { id: true, commitSha: true },
      }),
      client.technicalEvidenceReport.findFirst({
        where: { assessmentId },
        orderBy: { createdAt: "desc" },
        select: { id: true, schemaVersion: true },
      }),
    ]);
    return {
      sourceVersion: snapshot
        ? `${snapshot.id}:${snapshot.commitSha}`
        : MISSING_SOURCE_VERSION,
      pgeVersion: report
        ? `${report.id}:${report.schemaVersion}`
        : MISSING_PGE_VERSION,
      governedEvidenceRefs: [
        ...(snapshot ? [`repositorySnapshot:${snapshot.id}`] : []),
        ...(report ? [`technicalEvidenceReport:${report.id}`] : []),
        `interviewRuntime:${INTERVIEW_SOURCE_VERSION}`,
      ],
    };
  }

  private threadId(assessmentId: string): string {
    return `interview:${assessmentId}`;
  }
}

function parseAnswer(value: unknown): AssessmentInterviewAnswerInput {
  const record = objectRecord(value);
  if (!record || typeof record.questionId !== "string") {
    throw new BadRequestException({ code: "INTERVIEW_ANSWER_INVALID" });
  }
  return {
    questionId: record.questionId,
    freeText: typeof record.freeText === "string" ? record.freeText : undefined,
    selectedChoiceIds: Array.isArray(record.selectedChoiceIds)
      ? record.selectedChoiceIds.filter(
          (item): item is string => typeof item === "string",
        )
      : undefined,
    otherText:
      typeof record.otherText === "string" ? record.otherText : undefined,
    confirmed:
      typeof record.confirmed === "boolean" ? record.confirmed : undefined,
    adjusted:
      typeof record.adjusted === "boolean" ? record.adjusted : undefined,
  };
}

function parseBlockedAction(value: unknown): AssessmentInterviewBlockedInput {
  const record = objectRecord(value);
  if (
    !record ||
    !Object.values(ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS).includes(
      record.action as never,
    )
  ) {
    throw new BadRequestException({ code: "INTERVIEW_BLOCKED_ACTION_INVALID" });
  }
  return {
    action: record.action as AssessmentInterviewBlockedInput["action"],
    draft: typeof record.draft === "string" ? record.draft : undefined,
  };
}

function parseTargetedNeedRegistration(
  value: unknown,
): TargetedNeedRegistrationInput {
  const record = objectRecord(value);
  const criteria = Array.isArray(record?.resolutionCriteria)
    ? record.resolutionCriteria.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
  const affectedRuleIds = Array.isArray(record?.affectedRuleIds)
    ? record.affectedRuleIds.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
  const rawArtifactVersions = objectRecord(record?.artifactVersions);
  const artifactVersions = Object.fromEntries(
    Object.entries(rawArtifactVersions ?? {}).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && entry[1].trim().length > 0,
    ),
  );
  if (
    !record ||
    typeof record.actorId !== "string" ||
    typeof record.needId !== "string" ||
    typeof record.businessContextNeed !== "string" ||
    !criteria.length ||
    typeof record.originatingInvestigationReference !== "string" ||
    typeof record.investigatorExecutionId !== "string" ||
    typeof record.workflowRunId !== "string" ||
    typeof record.checkpointId !== "string" ||
    !affectedRuleIds.length ||
    !Object.keys(artifactVersions).length
  ) {
    throw new BadRequestException({ code: "INTERVIEW_TARGETED_NEED_INVALID" });
  }
  return {
    actorId: record.actorId,
    needId: record.needId,
    businessContextNeed: record.businessContextNeed,
    resolutionCriteria: criteria,
    originatingInvestigationReference: record.originatingInvestigationReference,
    investigatorExecutionId: record.investigatorExecutionId,
    workflowRunId: record.workflowRunId,
    checkpointId: record.checkpointId,
    affectedRuleIds,
    artifactVersions,
  };
}

function parseAgentDecision(value: unknown): AgentDecisionInput {
  const record = objectRecord(value);
  if (
    !record ||
    typeof record.expectedContextRevision !== "number" ||
    !Object.values(ASSESSMENT_INTERVIEW_OUTCOMES).includes(
      record.outcome as never,
    )
  ) {
    throw new BadRequestException({ code: "INTERVIEW_AGENT_DECISION_INVALID" });
  }
  return {
    expectedContextRevision: record.expectedContextRevision,
    mode:
      record.mode === "TARGETED_INTERVIEW" ||
      record.mode === "INITIAL_INTERVIEW"
        ? record.mode
        : undefined,
    outcome: record.outcome as AgentDecisionInput["outcome"],
    activeQuestion: objectRecord(record.activeQuestion)
      ? (record.activeQuestion as AssessmentInterviewRuntimeState["activeQuestion"])
      : undefined,
    contextAuthority: Object.values(
      ASSESSMENT_CONTEXT_AUTHORITY_STATUSES,
    ).includes(record.contextAuthority as never)
      ? (record.contextAuthority as AssessmentContextAuthorityStatus)
      : undefined,
    confirmedContext: objectRecord(record.confirmedContext) ?? undefined,
    blockedActions: Array.isArray(record.blockedActions)
      ? record.blockedActions.filter((item): item is never =>
          Object.values(ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS).includes(
            item as never,
          ),
        )
      : undefined,
    flags: Array.isArray(record.flags)
      ? record.flags.filter((item): item is never => typeof item === "string")
      : undefined,
  };
}

function parsePublicInterviewState(
  value: unknown,
): AssessmentInterviewRuntimeState | null {
  const record = objectRecord(value);
  if (
    !record ||
    !Object.values(ASSESSMENT_INTERVIEW_OUTCOMES).includes(
      record.outcome as never,
    )
  ) {
    return null;
  }
  return record as AssessmentInterviewRuntimeState;
}

function parsePrivateStore(value: unknown): PrivateInterviewStore {
  if (Array.isArray(value)) {
    return { revisions: value.filter(isPrivateRevision) };
  }
  const record = objectRecord(value);
  if (!record) {
    return { revisions: [] };
  }
  const revisions = Array.isArray(record.revisions)
    ? record.revisions.filter(isPrivateRevision)
    : [];
  const targetedNeed = parseStoredTargetedNeed(record.targetedNeed);
  const targetedContinuation = parseStoredTargetedContinuation(
    record.targetedContinuation,
  );
  return { revisions, targetedNeed, targetedContinuation };
}

function parseStoredTargetedNeed(
  value: unknown,
): TargetedInterviewNeed | undefined {
  const record = objectRecord(value);
  if (
    !record ||
    typeof record.needId !== "string" ||
    typeof record.businessContextNeed !== "string" ||
    !Array.isArray(record.resolutionCriteria) ||
    typeof record.originatingInvestigationReference !== "string" ||
    typeof record.sourceVersion !== "string" ||
    typeof record.pgeVersion !== "string"
  ) {
    return undefined;
  }
  return record as TargetedInterviewNeed;
}

function parseStoredTargetedContinuation(
  value: unknown,
): TargetedInterviewContinuation | undefined {
  const record = objectRecord(value);
  const artifactVersions = objectRecord(record?.artifactVersions);
  if (
    !record ||
    typeof record.originatingInvestigationReference !== "string" ||
    typeof record.investigatorExecutionId !== "string" ||
    typeof record.workflowRunId !== "string" ||
    typeof record.checkpointId !== "string" ||
    !Array.isArray(record.affectedRuleIds) ||
    !artifactVersions ||
    Object.keys(artifactVersions).length === 0 ||
    Object.values(artifactVersions).some(
      (value) => typeof value !== "string",
    ) ||
    typeof record.sourceVersion !== "string" ||
    typeof record.pgeVersion !== "string"
  ) {
    return undefined;
  }
  return record as TargetedInterviewContinuation;
}

function isPrivateRevision(
  value: unknown,
): value is PrivateInterviewAnswerRevision {
  const record = objectRecord(value);
  return (
    !!record &&
    typeof record.questionId === "string" &&
    objectRecord(record.answer) !== null &&
    typeof record.actorId === "string" &&
    typeof record.answeredAt === "string" &&
    typeof record.contextRevision === "number" &&
    typeof record.priorRevision === "number" &&
    Object.values(ASSESSMENT_CONTEXT_AUTHORITY_STATUSES).includes(
      record.authority as never,
    ) &&
    typeof record.sourceVersion === "string" &&
    typeof record.pgeVersion === "string" &&
    Array.isArray(record.governedEvidenceRefs)
  );
}

function assertGuardedDecision(
  decision: AgentDecisionInput,
  privateRevision: PrivateInterviewAnswerRevision | undefined,
  thread: {
    state: AssessmentInterviewRuntimeState;
    sourceVersion: string | null;
    pgeVersion: string | null;
    privateStore: PrivateInterviewStore;
  },
  correlationId: string,
  followup: { isBlockedFollowup: boolean; isTargetedBootstrap: boolean },
): void {
  if (
    !privateRevision &&
    !followup.isBlockedFollowup &&
    !followup.isTargetedBootstrap
  ) {
    throw problemException(
      "INTERVIEW_PRIVATE_REVISION_NOT_FOUND",
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
  if (
    decision.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer &&
    !decision.activeQuestion
  ) {
    throw problemException(
      "INTERVIEW_WAITING_REQUIRES_QUESTION",
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
  if (
    decision.outcome !== ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer &&
    decision.activeQuestion
  ) {
    throw problemException(
      "INTERVIEW_ACTIVE_QUESTION_OUTCOME_INVALID",
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
  assertAuthorityProvenance(
    decision.contextAuthority,
    privateRevision,
    correlationId,
  );
  if (
    decision.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.contextReady &&
    !isAuthoritative(decision.contextAuthority)
  ) {
    throw problemException(
      "INTERVIEW_CONTEXT_READY_REQUIRES_AUTHORITY",
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
  if (decision.outcome !== ASSESSMENT_INTERVIEW_OUTCOMES.contextResolved) {
    return;
  }
  if (decision.mode !== "TARGETED_INTERVIEW") {
    throw problemException(
      "INTERVIEW_CONTEXT_RESOLVED_REQUIRES_TARGETED_MODE",
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
  if (!isAuthoritative(decision.contextAuthority)) {
    throw problemException(
      "INTERVIEW_CONTEXT_RESOLVED_REQUIRES_AUTHORITY",
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
  const target = thread.privateStore.targetedNeed;
  const continuation = thread.privateStore.targetedContinuation;
  if (!target || !continuation) {
    throw problemException(
      "INTERVIEW_TARGETED_CONTEXT_NOT_REGISTERED",
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
  if (
    target.originatingInvestigationReference !==
    continuation.originatingInvestigationReference
  ) {
    throw problemException(
      "INTERVIEW_CONTINUATION_ORIGIN_MISMATCH",
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
  if (
    target.sourceVersion !== thread.sourceVersion ||
    target.pgeVersion !== thread.pgeVersion ||
    continuation.sourceVersion !== thread.sourceVersion ||
    continuation.pgeVersion !== thread.pgeVersion
  ) {
    throw problemException("INTERVIEW_CONTINUATION_STALE", correlationId, {
      status: HttpStatus.CONFLICT,
    });
  }
  if (!continuation.affectedRuleIds.length) {
    throw problemException(
      "INTERVIEW_CONTINUATION_SCOPE_REQUIRED",
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
  const context = decision.confirmedContext ?? {};
  const missing = target.resolutionCriteria.filter(
    (criterion) => !(criterion in context),
  );
  if (missing.length > 0) {
    throw problemException(
      "INTERVIEW_RESOLUTION_CRITERIA_UNSATISFIED",
      correlationId,
      {
        status: HttpStatus.CONFLICT,
        meta: { missing: missing.join(",") },
      },
    );
  }
}

function assertAuthorityProvenance(
  authority: AssessmentContextAuthorityStatus | undefined,
  privateRevision: PrivateInterviewAnswerRevision | undefined,
  correlationId: string,
): void {
  if (!isAuthoritative(authority)) {
    return;
  }
  if (!privateRevision) {
    throw problemException(
      "INTERVIEW_AUTHORITATIVE_CONTEXT_REQUIRES_CUSTOMER_REVISION",
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }

  const explicitlyConfirmed =
    privateRevision.questionControl ===
      ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust &&
    privateRevision.answer.confirmed === true &&
    privateRevision.answer.adjusted !== true;

  if (authority === ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerConfirmed) {
    if (!explicitlyConfirmed) {
      throw problemException(
        "INTERVIEW_CUSTOMER_CONFIRMED_REQUIRES_EXPLICIT_CONFIRMATION",
        correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    return;
  }

  if (
    privateRevision.questionIntent !==
      ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask ||
    privateRevision.questionControl ===
      ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust ||
    privateRevision.answer.adjusted === true
  ) {
    throw problemException(
      "INTERVIEW_CONFIRMED_REQUIRES_DIRECT_ASK",
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
}

function assertAnswerMatchesQuestion(
  answer: AssessmentInterviewAnswerInput,
  question: NonNullable<AssessmentInterviewRuntimeState["activeQuestion"]>,
): void {
  const invalid = () => {
    throw new BadRequestException({ code: "INTERVIEW_ANSWER_CONTROL_INVALID" });
  };
  const selected = answer.selectedChoiceIds ?? [];
  if (new Set(selected).size !== selected.length) {
    invalid();
  }
  const choiceById = new Map(
    (question.choices ?? []).map((choice) => [choice.id, choice]),
  );
  const unknownChoice = selected.some((choiceId) => !choiceById.has(choiceId));
  const requiresOtherText = selected.some(
    (choiceId) => choiceById.get(choiceId)?.requiresFreeText === true,
  );
  const hasOtherText = Boolean(answer.otherText?.trim());
  const hasFreeText = Boolean(answer.freeText?.trim());

  if (question.control === ASSESSMENT_INTERVIEW_CONTROLS.freeText) {
    if (
      !hasFreeText ||
      selected.length ||
      answer.confirmed ||
      answer.adjusted ||
      hasOtherText
    )
      invalid();
    return;
  }
  if (question.control === ASSESSMENT_INTERVIEW_CONTROLS.boolean) {
    if (
      selected.length !== 1 ||
      !["yes", "no"].includes(selected[0] ?? "") ||
      answer.confirmed ||
      answer.adjusted ||
      hasOtherText
    )
      invalid();
    return;
  }
  if (question.control === ASSESSMENT_INTERVIEW_CONTROLS.singleSelect) {
    if (
      selected.length !== 1 ||
      unknownChoice ||
      answer.confirmed ||
      answer.adjusted
    )
      invalid();
    if (requiresOtherText !== hasOtherText) invalid();
    return;
  }
  if (question.control === ASSESSMENT_INTERVIEW_CONTROLS.multiSelect) {
    if (
      !selected.length ||
      unknownChoice ||
      answer.confirmed ||
      answer.adjusted
    )
      invalid();
    if (requiresOtherText !== hasOtherText) invalid();
    return;
  }
  if (question.control === ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust) {
    if (answer.confirmed === answer.adjusted || selected.length || hasOtherText)
      invalid();
    return;
  }
  invalid();
}

function decisionState(
  current: AssessmentInterviewRuntimeState,
  decision: AgentDecisionInput,
): AssessmentInterviewRuntimeState {
  return {
    ...current,
    outcome: decision.outcome,
    activeQuestion:
      decision.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer
        ? decision.activeQuestion
        : undefined,
    contextAuthority: decision.contextAuthority ?? current.contextAuthority,
    confirmedContext:
      isAuthoritative(decision.contextAuthority) && decision.confirmedContext
        ? decision.confirmedContext
        : current.confirmedContext,
    blockedActions:
      decision.outcome === ASSESSMENT_INTERVIEW_OUTCOMES.blockedOrUnresolved
        ? (decision.blockedActions ??
          Object.values(ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS))
        : decision.blockedActions,
    flags: decision.flags ?? current.flags,
    orchestrationRequested: false,
  };
}

function isAuthoritative(value: unknown): boolean {
  return (
    value === ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerConfirmed ||
    value === ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.confirmed
  );
}

function summarizeAnswer(answer: AssessmentInterviewAnswerInput): string {
  if (answer.confirmed) {
    return "Customer confirmed prior material context.";
  }
  if (answer.adjusted) {
    return "Customer requested adjustment to prior material context.";
  }
  if (answer.selectedChoiceIds?.length) {
    return `Customer selected ${answer.selectedChoiceIds.length} option(s).`;
  }
  return "Customer supplied free-text Interview context.";
}

function publicState(
  state: AssessmentInterviewRuntimeState,
): AssessmentInterviewRuntimeState {
  return {
    ...state,
    confirmedContext: undefined,
    pendingDraft: state.pendingDraft,
    answerHistory: state.answerHistory?.map((item) => ({
      ...item,
      summary: item.summary,
    })),
  };
}

function runtimeEventState(
  state: AssessmentInterviewRuntimeState,
): AssessmentInterviewRuntimeState {
  return { ...publicState(state), pendingDraft: undefined };
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
