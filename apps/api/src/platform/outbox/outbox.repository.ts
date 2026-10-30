import { isRetiredOutboxEventType } from "./retired-event-policy.js";
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  type OutboxAggregateType,
  OUTBOX_STATUSES,
  type OutboxMessageInput,
  type OutboxStatus,
} from "@lcsp/contracts/outbox";

import {
  fromPrismaOutboxAggregateType,
  fromPrismaOutboxStatus,
  toPrismaOutboxAggregateType,
  toPrismaOutboxStatus,
} from "../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { OutboxMessageEntity } from "./outbox-message.entity.js";
import {
  ASSESSMENT_ROOT_COMMAND_TYPES,
  ROOT_CAPACITY_ID,
} from "@lcsp/contracts/assessment-domain";

interface OutboxRow {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  status: string;
  attempts: number;
  lastAttemptAt: Date | null;
  nextAttemptAt: Date | null;
  publishedAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
}

/**
 * Encapsulates transactional outbox persistence and delivery-state updates.
 */
@Injectable()
export class OutboxRepository {
  /**
   * Creates the repository with the application Prisma client.
   *
   * @param prisma - Prisma service used for outbox database operations.
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Business purpose: Durably enqueue an idempotent command/event and its Root admission intent.
   * Business rules:
   * - Retired events remain forbidden; duplicate deterministic IDs must not abort the caller's transaction.
   * - Root demand commits in the same transaction as its canonical outbox command, including Continue.
   * Execution flow:
   * 1. Reject retired event types and ensure Root enqueue uses a transaction.
   * 2. Upsert the canonical message and, for a Root request, its durable admission bookkeeping.
   * Failure cases:
   * - Persistence failure rolls back both command and admission intent; duplicate enqueue never reopens consumed work.
   * Side effects:
   * - Persists outbox/admission intent only; broker delivery, Root decisions and paid calls remain separate authorities.
   */
  async enqueue(
    input: OutboxMessageInput,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    // CUTOVER fence: a retired V1 command/event must never be created again, whatever code path asks.
    if (isRetiredOutboxEventType(input.eventType))
      throw new Error(`OUTBOX_EVENT_TYPE_RETIRED: ${input.eventType}`);
    const isRoot =
      input.eventType === ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED;
    if (isRoot && !tx)
      return this.prisma.$transaction((client) => this.enqueue(input, client));
    const client = tx ?? this.prisma;
    const message = OutboxMessageEntity.create(input);

    const persisted = await client.outboxMessage.upsert({
      where: { id: message.id },
      update: {},
      create: {
        id: message.id,
        aggregateType: toPrismaOutboxAggregateType(message.aggregateType),
        aggregateId: message.aggregateId,
        eventType: message.eventType,
        payload: message.payload as Prisma.InputJsonValue,
        status: toPrismaOutboxStatus(message.status),
        attempts: message.attempts,
        createdAt: message.createdAt,
      },
    });
    if (isRoot)
      await client.assessmentRootAdmissionRequest.upsert({
        where: { commandId: message.id },
        update: {},
        create: {
          commandId: message.id,
          assessmentId: message.aggregateId,
          requestedAt: persisted.createdAt,
        },
      });

    return message.id;
  }

  /**
   * Locks an eligible pending batch with `FOR UPDATE SKIP LOCKED` and executes a handler before the transaction commits.
   * The row locks remain held while `handler` runs, preventing another publisher instance from selecting the same messages concurrently.
   *
   * @param batchSize - Maximum number of deliverable messages to lock in one transaction.
   * @param handler - Callback that processes the locked entities using the same Prisma transaction.
   * @returns The handler result, or null when no eligible outbox messages are available.
   */
  async withPendingBatch<T>(
    batchSize: number,
    handler: (
      messages: OutboxMessageEntity[],
      tx: Prisma.TransactionClient,
    ) => Promise<T>,
  ): Promise<T | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<OutboxRow[]>`
        SELECT * FROM "OutboxMessage"
        WHERE status = ${OUTBOX_STATUSES.pending}
          OR (
            status = ${OUTBOX_STATUSES.failed}
            -- Prisma persists DateTime as UTC in a timestamp-without-zone
            -- column. Compare against a UTC timestamp without zone to avoid
            -- treating future retries as due on servers with a non-UTC TZ.
            AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= (NOW() AT TIME ZONE 'UTC'))
          )
        ORDER BY "createdAt" ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      `;

      if (rows.length === 0) {
        return null;
      }

      const messages = rows.map((row) =>
        OutboxMessageEntity.fromPersistence({
          ...row,
          aggregateType: row.aggregateType as OutboxAggregateType,
          payload: row.payload as Record<string, unknown>,
          status: row.status as OutboxStatus,
        }),
      );

      return handler(messages, tx);
    });
  }

  /**
   * Marks an outbox message as successfully published within the active transaction.
   *
   * @param tx - Prisma transaction holding the outbox row lock.
   * @param id - Outbox message identifier.
   * @param publishedAt - Timestamp at which publication succeeded.
   * @returns A promise that resolves after the delivery state is updated.
   */
  async markPublished(
    tx: Prisma.TransactionClient,
    id: string,
    publishedAt: Date,
  ): Promise<void> {
    await tx.outboxMessage.update({
      where: { id },
      data: {
        status: toPrismaOutboxStatus(OUTBOX_STATUSES.published),
        publishedAt,
      },
    });
  }

  /**
   * Records a failed publication attempt and transitions the message to retryable failure or DLQ state.
   *
   * @param tx - Prisma transaction holding the outbox row lock.
   * @param id - Outbox message identifier.
   * @param attempts - Updated number of attempts after the failure.
   * @param maxAttempts - Maximum attempts allowed before entering the DLQ.
   * @param errorMessage - Delivery error message stored in bounded form.
   * @param now - Timestamp of the failed attempt.
   * @param nextAttemptAt - Scheduled retry time, or null for a terminal DLQ failure.
   * @returns A promise that resolves after failure state is persisted.
   */
  async markFailure(
    tx: Prisma.TransactionClient,
    id: string,
    attempts: number,
    maxAttempts: number,
    errorMessage: string,
    now: Date,
    nextAttemptAt: Date | null,
  ): Promise<void> {
    const status: OutboxStatus =
      attempts >= maxAttempts ? OUTBOX_STATUSES.dlq : OUTBOX_STATUSES.failed;

    await tx.outboxMessage.update({
      where: { id },
      data: {
        status: toPrismaOutboxStatus(status),
        attempts,
        lastAttemptAt: now,
        nextAttemptAt,
        errorMessage: errorMessage.slice(0, 500),
      },
    });
  }

  /**
   * Lists outbox messages currently in the dead-letter queue, newest first.
   *
   * @returns Rehydrated DLQ message entities.
   */
  async findDlqMessages(): Promise<OutboxMessageEntity[]> {
    const rows = await this.prisma.outboxMessage.findMany({
      where: { status: toPrismaOutboxStatus(OUTBOX_STATUSES.dlq) },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) =>
      OutboxMessageEntity.fromPersistence({
        ...row,
        aggregateType: fromPrismaOutboxAggregateType(row.aggregateType),
        payload: row.payload as Record<string, unknown>,
        status: fromPrismaOutboxStatus(row.status),
      }),
    );
  }

  /**
   * Finds a single outbox message by its identifier.
   *
   * @param id - Outbox message identifier to look up.
   * @returns Rehydrated message entity, or null when no row exists.
   */
  async findMessageById(id: string): Promise<OutboxMessageEntity | null> {
    const row = await this.prisma.outboxMessage.findUnique({
      where: { id },
    });
    if (!row) return null;
    return OutboxMessageEntity.fromPersistence({
      ...row,
      aggregateType: fromPrismaOutboxAggregateType(row.aggregateType),
      payload: row.payload as Record<string, unknown>,
      status: fromPrismaOutboxStatus(row.status),
    });
  }

  /**
   * Business purpose: Replay an operator-approved failed delivery through its existing durable publisher.
   * Business rules:
   * - The DLQ service retains authorization/lifecycle guards; replay cannot release physical Root occupancy.
   * - Only a quiescent Root command may reopen its operational admission intent; accepted domain work is unchanged.
   * Execution flow:
   * 1. Reset transport retry metadata and reopen quiescent admission bookkeeping in one transaction.
   * Failure cases:
   * - Missing message or persistence errors roll back both updates; live slots retain their existing authority.
   * Side effects:
   * - Updates outbox/admission bookkeeping; the caller preserves the existing operator audit.
   */
  async resetMessageForReplay(id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Serialize replay with admission whenever physical authority has been initialized.
      await tx.$queryRaw`SELECT "id" FROM "AssessmentRootCapacity" WHERE "id" = ${ROOT_CAPACITY_ID} FOR UPDATE`;
      await tx.assessmentRootAdmissionRequest.updateMany({
        where: { commandId: id, slots: { none: { releasedAt: null } } },
        data: { completedAt: null, admittedRunId: null, deliveredAt: null },
      });
      await tx.outboxMessage.update({
        where: { id },
        data: {
          status: toPrismaOutboxStatus(OUTBOX_STATUSES.pending),
          attempts: 0,
          nextAttemptAt: null,
          errorMessage: null,
        },
      });
    });
  }

  /**
   * Business purpose: Discard an operator-selected DLQ delivery while retaining physical Root authority and audit links.
   * Business rules:
   * - Root commands referenced by admission history become cancelled tombstones; their slots/history cannot cascade away.
   * - Unreferenced transport messages keep the existing physical deletion behavior.
   * Execution flow:
   * 1. Find admission bookkeeping and cancel its transport record, or delete an unreferenced message.
   * Failure cases:
   * - Missing message or database failure rejects atomically; discard never cancels a living native Root.
   * Side effects:
   * - Removes the message from DLQ visibility while preserving Root history; the caller records the discard audit.
   */
  async deleteMessage(id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const intent = await tx.assessmentRootAdmissionRequest.findUnique({
        where: { commandId: id },
        select: { commandId: true },
      });
      if (intent)
        await tx.outboxMessage.update({
          where: { id },
          data: { status: toPrismaOutboxStatus(OUTBOX_STATUSES.cancelled) },
        });
      else await tx.outboxMessage.delete({ where: { id } });
    });
  }
}
