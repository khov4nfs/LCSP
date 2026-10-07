import {
  AGENT_EXECUTION_STATES,
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  AGENTIC_RUNTIME_TRANSITION_GUARDS,
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_EVENT_ACTOR_TYPES,
  ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_LIFECYCLE_STATES,
  ASSESSMENT_LIFECYCLE_TRANSITIONS,
  assessmentBlockerSchema,
  assessmentEventSchema,
  assessmentLifecycleChangedPayloadSchema,
  isAgenticRuntimeTransitionAllowed,
  type AgenticRuntimeTransitionGuard,
  type AssessmentBlocker,
  type AssessmentEvent,
  type AssessmentLifecycleState,
} from "@lcsp/contracts/assessment";
import {
  AUDIT_ACTOR_IDS,
  AUDIT_ACTOR_TYPES,
  AUDIT_REDACTION_STATUSES,
  type AuditActorType,
} from "@lcsp/contracts/audit";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { ASSESSMENT_RUNTIME_CONTROL_STATES } from "@lcsp/contracts/evidence";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { HttpStatus, Injectable } from "@nestjs/common";
import {
  Prisma,
  type AssessmentEvent as PrismaAssessmentEvent,
} from "@prisma/client";
import { randomUUID } from "node:crypto";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import type { RbacRequestContext } from "../../../../platform/rbac/interfaces/rbac-request.interface.js";

const CANONICAL_EVENT_TYPE =
  AGENTIC_ASSESSMENT_EVENT_TYPES.ASSESSMENT_LIFECYCLE_CHANGED;
const CANONICAL_ACTOR_TYPE = ASSESSMENT_EVENT_ACTOR_TYPES.API;

export type AssessmentLifecycleTransitionInput = {
  assessmentId: string;
  expectedRevision: number;
  toState: AssessmentLifecycleState;
  correlationId: string;
  eventId?: string;
  actorId: string;
  blocker?: AssessmentBlocker;
};

export type AssessmentLifecycleTransitionResult = {
  assessmentId: string;
  threadId: string;
  eventId: string;
  sequence: number;
  fromState: AssessmentLifecycleState;
  toState: AssessmentLifecycleState;
  assessmentRevision: number;
  blocker?: AssessmentBlocker;
};

export type AssessmentLifecycleInitializationResult = {
  assessmentId: string;
  threadId: string;
  lifecycleState: typeof ASSESSMENT_LIFECYCLE_STATES.CREATED;
  lifecycleRevision: 0;
};

export type LifecycleEventActor = {
  id: string;
  type: AuditActorType;
};

type RuntimeAcknowledgementProof = {
  targetRunId: string;
  acknowledgedState:
    | typeof ASSESSMENT_RUNTIME_CONTROL_STATES.running
    | typeof ASSESSMENT_RUNTIME_CONTROL_STATES.stopped;
  requestId: string | null;
};

/**
 * Sole API writer for canonical Assessment lifecycle state.
 *
 * V1 rows without canonical lifecycle/runtime data are intentionally unavailable
 * here. This service never derives a V2 state from legacy rows or event history.
 */
@Injectable()
export class AssessmentLifecycleCoordinator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxRepository,
  ) {}

  /** Creates the server-owned canonical row pair for a newly created assessment. */
  async initialize(input: {
    assessmentId: string;
    ownerId: string;
    rootAgentVersion: string;
    checkpointNamespace: string;
    correlationId: string;
  }): Promise<AssessmentLifecycleInitializationResult> {
    return this.prisma.$transaction((tx) => this.initializeInTx(input, tx));
  }

  /** Same initialization protocol for a caller that already owns a transaction. */
  async initializeInTx(
    input: {
      assessmentId: string;
      ownerId: string;
      rootAgentVersion: string;
      checkpointNamespace: string;
      correlationId: string;
    },
    tx: Prisma.TransactionClient,
  ): Promise<AssessmentLifecycleInitializationResult> {
    const assessment = await tx.assessment.findUnique({
      where: { id: input.assessmentId },
      select: {
        id: true,
        ownerId: true,
        lifecycleState: true,
        lifecycleRevision: true,
      },
    });
    if (!assessment || assessment.ownerId !== input.ownerId) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        input.correlationId,
        {
          status: HttpStatus.NOT_FOUND,
        },
      );
    }
    if (
      assessment.lifecycleState !== null ||
      assessment.lifecycleRevision !== null
    ) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid,
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }

    const threadId = randomUUID();
    await tx.assessment.update({
      where: { id: input.assessmentId },
      data: {
        lifecycleState: ASSESSMENT_LIFECYCLE_STATES.CREATED,
        lifecycleRevision: 0,
      },
    });
    await tx.assessmentRuntime.create({
      data: {
        assessmentId: input.assessmentId,
        threadId,
        rootAgentVersion: input.rootAgentVersion,
        checkpointNamespace: input.checkpointNamespace,
      },
    });

    return {
      assessmentId: input.assessmentId,
      threadId,
      lifecycleState: ASSESSMENT_LIFECYCLE_STATES.CREATED,
      lifecycleRevision: 0,
    };
  }

  /**
   * Validates and commits one lifecycle transition with its ordered event/outbox.
   * The event ID is the idempotency key; replay returns the committed event.
   */
  async transition(
    input: AssessmentLifecycleTransitionInput,
  ): Promise<AssessmentLifecycleTransitionResult> {
    return this.prisma.$transaction((tx) => this.transitionInTx(input, tx));
  }

  /** Same transition protocol for a caller that already owns a transaction. */
  async transitionInTx(
    input: AssessmentLifecycleTransitionInput,
    tx: Prisma.TransactionClient,
  ): Promise<AssessmentLifecycleTransitionResult> {
    return this.transitionWithGuards(input, tx, [], {
      id: input.actorId,
      type: AUDIT_ACTOR_TYPES.user,
    });
  }

  /**
   * Transition for an OWNING server boundary that has already verified the named guard
   * conditions from authoritative state (for example the runtime-preparation service proving
   * pinned inputs and full decision coverage). Callers never forward guards from a client or
   * an agent; the table in the contracts still decides whether the transition is legal.
   */
  async transitionVerifiedInTx(
    input: AssessmentLifecycleTransitionInput,
    tx: Prisma.TransactionClient,
    verifiedGuards: readonly AgenticRuntimeTransitionGuard[],
    actor: LifecycleEventActor,
  ): Promise<AssessmentLifecycleTransitionResult> {
    return this.transitionWithGuards(input, tx, verifiedGuards, actor);
  }

  private async transitionWithGuards(
    input: AssessmentLifecycleTransitionInput,
    tx: Prisma.TransactionClient,
    additionalGuards: readonly AgenticRuntimeTransitionGuard[],
    actor: LifecycleEventActor = {
      id: input.actorId,
      type: AUDIT_ACTOR_TYPES.user,
    },
    runtimeAcknowledgement?: RuntimeAcknowledgementProof,
  ): Promise<AssessmentLifecycleTransitionResult> {
    const eventId = input.eventId ?? randomUUID();
    if (!isUuid(eventId)) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.invalidRequest,
        input.correlationId,
        {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
        },
      );
    }
    if (
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0 ||
      input.expectedRevision >= Number.MAX_SAFE_INTEGER
    ) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.invalidRequest,
        input.correlationId,
        {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
        },
      );
    }

    // Row locks make sequence allocation and the lifecycle CAS one serial order.
    const { assessment, runtime } = await this.lockCanonicalRows(
      tx,
      input.assessmentId,
      input.correlationId,
    );
    if (!assessment) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid,
        input.correlationId,
        {
          status: HttpStatus.CONFLICT,
        },
      );
    }
    if (
      actor.type === AUDIT_ACTOR_TYPES.user &&
      actor.id !== assessment.ownerId
    ) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        input.correlationId,
        {
          status: HttpStatus.NOT_FOUND,
        },
      );
    }

    if (
      assessment.lifecycleState === null ||
      assessment.lifecycleRevision === null
    ) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid,
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }

    if (runtimeAcknowledgement) {
      await this.assertRuntimeAcknowledgementProof(
        tx,
        assessment,
        runtime,
        runtimeAcknowledgement,
        input.correlationId,
      );
    }

    // The assessment lock serializes fresh requests. Re-read the event after
    // that lock and before stale CAS so a committed retry returns its result.
    const committedEvent = await tx.assessmentEvent.findUnique({
      where: { eventId },
    });
    if (committedEvent) {
      const replay = this.toDomainEvent(committedEvent, input.correlationId);
      this.assertReplayMatchesCommand(
        replay,
        input,
        runtime,
        input.correlationId,
      );
      return this.toResult(replay);
    }

    if (assessment.lifecycleRevision !== input.expectedRevision) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.ruleAssessmentStale,
        input.correlationId,
        {
          status: HttpStatus.CONFLICT,
          meta: { currentRevision: assessment.lifecycleRevision },
        },
      );
    }

    const guards = [
      ...additionalGuards,
      AGENTIC_RUNTIME_TRANSITION_GUARDS.AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT,
    ];
    if (
      !isAgenticRuntimeTransitionAllowed(
        ASSESSMENT_LIFECYCLE_TRANSITIONS,
        assessment.lifecycleState,
        input.toState,
        guards,
      )
    ) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.invalidRequest,
        input.correlationId,
        {
          status: HttpStatus.CONFLICT,
          meta: {
            fromState: assessment.lifecycleState,
            toState: input.toState,
          },
        },
      );
    }

    const blocker = validateBlocker(
      input.toState,
      input.blocker,
      input.correlationId,
    );
    const nextRevision = input.expectedRevision + 1;
    const updated = await tx.assessment.updateMany({
      where: {
        id: input.assessmentId,
        lifecycleState: assessment.lifecycleState,
        lifecycleRevision: input.expectedRevision,
      },
      data: {
        lifecycleState: input.toState,
        lifecycleRevision: nextRevision,
        blockerReason: blocker?.reason ?? null,
        blockerReference: blocker?.reference
          ? (blocker.reference as Prisma.InputJsonValue)
          : Prisma.DbNull,
      },
    });
    if (updated.count !== 1) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.ruleAssessmentStale,
        input.correlationId,
        {
          status: HttpStatus.CONFLICT,
        },
      );
    }

    const sequence = runtime.eventSequence + 1;
    await tx.assessmentRuntime.update({
      where: { assessmentId: input.assessmentId },
      data: { eventSequence: sequence },
    });
    const payload = assessmentLifecycleChangedPayloadSchema.parse({
      fromState: assessment.lifecycleState,
      toState: input.toState,
      assessmentRevision: nextRevision,
      ...(blocker ? { blocker } : {}),
    });
    const timestamp = new Date();
    const envelope = assessmentEventSchema.parse({
      eventId,
      assessmentId: input.assessmentId,
      threadId: runtime.threadId,
      sequence,
      timestamp: timestamp.toISOString(),
      eventType: CANONICAL_EVENT_TYPE,
      actorType: CANONICAL_ACTOR_TYPE,
      payload,
    });
    const outboxMessageId = await this.outbox.enqueue(
      buildOutboxMessageInput({
        aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
        aggregateId: input.assessmentId,
        assessmentId: input.assessmentId,
        eventType: ASSESSMENT_EVENT_TYPES.lifecycleChangedOutbox,
        correlationId: input.correlationId,
        causationId: eventId,
        actor,
        result: CANONICAL_EVENT_TYPE,
        redactionStatus: AUDIT_REDACTION_STATUSES.redacted,
        idempotencyKey: `${input.assessmentId}:${eventId}`,
        payload: { assessmentEvent: envelope },
      }),
      tx,
    );
    const persisted = await tx.assessmentEvent.create({
      data: {
        eventId,
        assessmentId: input.assessmentId,
        threadId: runtime.threadId,
        sequence,
        timestamp,
        eventType: CANONICAL_EVENT_TYPE,
        actorType: CANONICAL_ACTOR_TYPE,
        payload,
        outboxMessageId,
      },
    });
    return this.toResult(this.toDomainEvent(persisted, input.correlationId));
  }

  /** Runtime acknowledgements are a server boundary, never guard attestations. */
  async transitionFromRuntimeAcknowledgementInTx(
    input: {
      assessmentId: string;
      targetRunId: string;
      acknowledgedState:
        | typeof ASSESSMENT_RUNTIME_CONTROL_STATES.running
        | typeof ASSESSMENT_RUNTIME_CONTROL_STATES.stopped;
      requestId: string | null;
      correlationId: string;
    },
    tx: Prisma.TransactionClient,
  ): Promise<AssessmentLifecycleTransitionResult> {
    const { assessment } = await this.lockCanonicalRows(
      tx,
      input.assessmentId,
      input.correlationId,
    );
    if (
      assessment.lifecycleState === null ||
      assessment.lifecycleRevision === null
    ) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid,
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    return this.transitionWithGuards(
      {
        assessmentId: input.assessmentId,
        actorId: AUDIT_ACTOR_IDS.assessmentOrchestrator,
        expectedRevision: assessment.lifecycleRevision,
        toState:
          input.acknowledgedState === ASSESSMENT_RUNTIME_CONTROL_STATES.stopped
            ? ASSESSMENT_LIFECYCLE_STATES.PAUSED
            : ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
        correlationId: input.correlationId,
        eventId: randomUUID(),
      },
      tx,
      input.acknowledgedState === ASSESSMENT_RUNTIME_CONTROL_STATES.stopped
        ? [AGENTIC_RUNTIME_TRANSITION_GUARDS.EXPLICIT_SAFE_PAUSE]
        : [],
      {
        id: AUDIT_ACTOR_IDS.assessmentOrchestrator,
        type: AUDIT_ACTOR_TYPES.service,
      },
      {
        targetRunId: input.targetRunId,
        acknowledgedState: input.acknowledgedState,
        requestId: input.requestId,
      },
    );
  }

  private async lockCanonicalRows(
    tx: Prisma.TransactionClient,
    assessmentId: string,
    correlationId: string,
  ): Promise<{
    assessment: CanonicalAssessmentRow;
    runtime: CanonicalRuntimeRow;
  }> {
    const assessmentRows = await tx.$queryRaw<CanonicalAssessmentRow[]>(
      Prisma.sql`SELECT "id", "ownerId", "lifecycleState", "lifecycleRevision"
          FROM "Assessment" WHERE "id" = ${assessmentId} FOR UPDATE`,
    );
    const assessment = assessmentRows[0];
    if (!assessment) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid,
        correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    const runtimeRows = await tx.$queryRaw<CanonicalRuntimeRow[]>(
      Prisma.sql`SELECT "assessmentId", "threadId", "eventSequence"
          FROM "AssessmentRuntime" WHERE "assessmentId" = ${assessmentId} FOR UPDATE`,
    );
    const runtime = runtimeRows[0];
    if (!runtime) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid,
        correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    return { assessment, runtime };
  }

  private async assertRuntimeAcknowledgementProof(
    tx: Prisma.TransactionClient,
    assessment: CanonicalAssessmentRow,
    runtime: CanonicalRuntimeRow,
    proof: RuntimeAcknowledgementProof,
    correlationId: string,
  ): Promise<void> {
    const persistedRuntime = await tx.assessmentRuntime.findUnique({
      where: { assessmentId: assessment.id },
      select: {
        assessmentId: true,
        threadId: true,
        checkpointNamespace: true,
        currentExecutionId: true,
        executionState: true,
      },
    });
    const turn = await tx.assessmentRuntimeTurn.findUnique({
      where: { id: proof.targetRunId },
      select: {
        id: true,
        assessmentId: true,
        threadId: true,
        state: true,
        requestId: true,
        checkpointJson: true,
      },
    });
    const validBinding =
      persistedRuntime?.assessmentId === assessment.id &&
      persistedRuntime.threadId === runtime.threadId &&
      persistedRuntime.checkpointNamespace === assessment.id &&
      persistedRuntime.currentExecutionId === turn?.id &&
      turn?.assessmentId === assessment.id &&
      turn?.threadId === runtime.threadId &&
      turn?.requestId === proof.requestId;
    const validAcknowledgement =
      proof.acknowledgedState === ASSESSMENT_RUNTIME_CONTROL_STATES.stopped
        ? turn?.state === ASSESSMENT_RUNTIME_CONTROL_STATES.stopped &&
          proof.requestId !== null &&
          turn.checkpointJson !== null &&
          persistedRuntime?.executionState === AGENT_EXECUTION_STATES.PAUSED
        : turn?.state === ASSESSMENT_RUNTIME_CONTROL_STATES.running &&
          persistedRuntime?.executionState === AGENT_EXECUTION_STATES.RUNNING;
    if (!validBinding || !validAcknowledgement) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid,
        correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
  }

  async current(
    assessmentId: string,
    actor: RbacRequestContext,
    correlationId: string,
  ): Promise<{
    state: AssessmentLifecycleState;
    revision: number;
  } | null> {
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: {
        ownerId: true,
        lifecycleState: true,
        lifecycleRevision: true,
      },
    });
    if (
      !assessment ||
      (actor.role !== AUTH_USER_ROLES.admin &&
        assessment.ownerId !== actor.userId)
    ) {
      throw problemException(ASSESSMENT_ERROR_CODES.notFound, correlationId, {
        status: HttpStatus.NOT_FOUND,
      });
    }
    if (
      assessment.lifecycleState === null &&
      assessment.lifecycleRevision === null
    ) {
      return null;
    }
    if (
      assessment.lifecycleState === null ||
      assessment.lifecycleRevision === null
    ) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid,
        correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    return {
      state: assessment.lifecycleState,
      revision: assessment.lifecycleRevision,
    };
  }

  private toResult(
    event: AssessmentEvent,
  ): AssessmentLifecycleTransitionResult {
    if (
      event.eventType !== CANONICAL_EVENT_TYPE ||
      event.actorType !== CANONICAL_ACTOR_TYPE
    ) {
      throw new Error("Assessment lifecycle event has an invalid type");
    }
    const payload = event.payload;
    const blocker = "blocker" in payload ? payload.blocker : undefined;
    return {
      assessmentId: event.assessmentId,
      threadId: event.threadId,
      eventId: event.eventId,
      sequence: event.sequence,
      fromState: payload.fromState,
      toState: payload.toState,
      assessmentRevision: payload.assessmentRevision,
      ...(blocker ? { blocker } : {}),
    };
  }

  private toDomainEvent(
    event: PrismaAssessmentEvent,
    correlationId: string,
  ): AssessmentEvent {
    const parsed = assessmentEventSchema.safeParse({
      eventId: event.eventId,
      assessmentId: event.assessmentId,
      threadId: event.threadId,
      sequence: event.sequence,
      timestamp: event.timestamp.toISOString(),
      eventType: event.eventType,
      actorType: event.actorType,
      ...(event.executionId ? { executionId: event.executionId } : {}),
      ...(event.parentExecutionId
        ? { parentExecutionId: event.parentExecutionId }
        : {}),
      ...(event.taskId ? { taskId: event.taskId } : {}),
      ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
      ...(event.tokenUsage ? { tokenUsage: event.tokenUsage } : {}),
      ...(event.technicalDetailsRef
        ? { technicalDetailsRef: event.technicalDetailsRef }
        : {}),
      payload: event.payload,
    });
    if (!parsed.success) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid,
        correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    return parsed.data;
  }

  private assertReplayMatchesCommand(
    event: AssessmentEvent,
    input: AssessmentLifecycleTransitionInput,
    runtime: CanonicalRuntimeRow,
    correlationId: string,
  ): void {
    if (
      event.assessmentId !== input.assessmentId ||
      event.threadId !== runtime.threadId ||
      event.eventType !== CANONICAL_EVENT_TYPE ||
      event.actorType !== CANONICAL_ACTOR_TYPE ||
      event.payload.toState !== input.toState ||
      event.payload.assessmentRevision !== input.expectedRevision + 1 ||
      JSON.stringify(
        "blocker" in event.payload ? event.payload.blocker : null,
      ) !== JSON.stringify(input.blocker ?? null)
    ) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid,
        correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
  }
}

type CanonicalAssessmentRow = {
  id: string;
  ownerId: string;
  lifecycleState: AssessmentLifecycleState | null;
  lifecycleRevision: number | null;
};

type CanonicalRuntimeRow = {
  assessmentId: string;
  threadId: string;
  eventSequence: number;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

function validateBlocker(
  toState: AssessmentLifecycleState,
  blocker: AssessmentBlocker | undefined,
  correlationId: string,
): AssessmentBlocker | undefined {
  if (toState === ASSESSMENT_LIFECYCLE_STATES.BLOCKED && !blocker) {
    throw problemException(
      ASSESSMENT_ERROR_CODES.invalidRequest,
      correlationId,
      {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      },
    );
  }
  if (toState !== ASSESSMENT_LIFECYCLE_STATES.BLOCKED && blocker) {
    throw problemException(
      ASSESSMENT_ERROR_CODES.invalidRequest,
      correlationId,
      {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      },
    );
  }
  if (!blocker) return undefined;
  const parsed = assessmentBlockerSchema.safeParse(blocker);
  if (!parsed.success) {
    throw problemException(
      ASSESSMENT_ERROR_CODES.invalidRequest,
      correlationId,
      {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      },
    );
  }
  return parsed.data;
}
