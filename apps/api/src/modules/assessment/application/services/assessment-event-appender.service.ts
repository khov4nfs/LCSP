import { randomUUID } from "node:crypto";

import {
  ASSESSMENT_EVENT_TYPES,
  assessmentEventSchema,
  type AssessmentEventActorType,
  type AssessmentEventType,
} from "@lcsp/contracts/assessment";
import {
  AUDIT_REDACTION_STATUSES,
  type AuditActorType,
} from "@lcsp/contracts/audit";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";

export interface AppendAssessmentEventInput {
  assessmentId: string;
  correlationId: string;
  eventId?: string;
  eventType: AssessmentEventType;
  actorType: AssessmentEventActorType;
  /** Typed, event-specific payload; validated against the canonical envelope schema. */
  payload: unknown;
  executionId?: string;
  parentExecutionId?: string;
  taskId?: string;
  toolCallId?: string;
  auditActor: { id: string; type: AuditActorType };
}

/**
 * The one writer of NON-lifecycle AssessmentEvents. It allocates the monotonic per-assessment
 * sequence under the runtime row lock, validates the canonical envelope, and persists the event
 * with its outbox row in the caller's transaction, so a domain write and its event commit or
 * roll back together. Python never supplies identity, order or actor fields.
 */
@Injectable()
export class AssessmentEventAppender {
  constructor(private readonly outbox: OutboxRepository) {}

  async appendInTx(
    tx: Prisma.TransactionClient,
    input: AppendAssessmentEventInput,
  ): Promise<{ eventId: string; sequence: number; threadId: string }> {
    const eventId = input.eventId ?? randomUUID();
    const existing = await tx.assessmentEvent.findUnique({
      where: { eventId },
    });
    if (existing) {
      return {
        eventId,
        sequence: existing.sequence,
        threadId: existing.threadId,
      };
    }
    const rows = await tx.$queryRaw<
      Array<{ threadId: string; eventSequence: number }>
    >(
      Prisma.sql`SELECT "threadId", "eventSequence" FROM "AssessmentRuntime"
        WHERE "assessmentId" = ${input.assessmentId} FOR UPDATE`,
    );
    const runtime = rows[0];
    if (!runtime) {
      throw new Error("assessment runtime row is required to append an event");
    }
    const sequence = runtime.eventSequence + 1;
    await tx.assessmentRuntime.update({
      where: { assessmentId: input.assessmentId },
      data: { eventSequence: sequence },
    });
    const timestamp = new Date();
    const envelope = assessmentEventSchema.parse({
      eventId,
      assessmentId: input.assessmentId,
      threadId: runtime.threadId,
      sequence,
      timestamp: timestamp.toISOString(),
      eventType: input.eventType,
      actorType: input.actorType,
      payload: input.payload,
      ...(input.executionId ? { executionId: input.executionId } : {}),
      ...(input.parentExecutionId
        ? { parentExecutionId: input.parentExecutionId }
        : {}),
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
    });
    const outboxMessageId = await this.outbox.enqueue(
      buildOutboxMessageInput({
        aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
        aggregateId: input.assessmentId,
        assessmentId: input.assessmentId,
        eventType: ASSESSMENT_EVENT_TYPES.eventRecordedOutbox,
        correlationId: input.correlationId,
        causationId: eventId,
        actor: input.auditActor,
        result: input.eventType,
        redactionStatus: AUDIT_REDACTION_STATUSES.redacted,
        idempotencyKey: `${input.assessmentId}:${eventId}`,
        payload: { assessmentEvent: envelope },
      }),
      tx,
    );
    await tx.assessmentEvent.create({
      data: {
        eventId,
        assessmentId: input.assessmentId,
        threadId: runtime.threadId,
        sequence,
        timestamp,
        eventType: input.eventType,
        actorType: input.actorType,
        payload: input.payload as Prisma.InputJsonValue,
        executionId: input.executionId ?? null,
        parentExecutionId: input.parentExecutionId ?? null,
        taskId: input.taskId ?? null,
        toolCallId: input.toolCallId ?? null,
        outboxMessageId,
      },
    });
    return { eventId, sequence, threadId: runtime.threadId };
  }
}
