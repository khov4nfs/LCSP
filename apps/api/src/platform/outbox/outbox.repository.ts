import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  TARGETED_REANALYSIS_CAPACITY_POLICY,
  TARGETED_REANALYSIS_CHECKPOINT_STATES,
  TARGETED_REANALYSIS_REQUEST_STATES,
} from "@lcsp/contracts/scan";
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
 * Encapsulates transactional outbox persistence, delivery-state updates, and targeted-reanalysis dispatch reservation.
 */
@Injectable()
export class OutboxRepository {
  /**
   * Creates the repository with the application Prisma client.
   *
   * @param prisma - Prisma service used for outbox and targeted-reanalysis database operations.
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Inserts a new pending outbox message; the publisher poller delivers it separately.
   *
   * @param input - Aggregate and event payload to enqueue.
   * @param tx - Optional existing Prisma transaction in which the enqueue must participate.
   * @returns Identifier of the newly created outbox message.
   */
  async enqueue(
    input: OutboxMessageInput,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const client = tx ?? this.prisma;
    const message = OutboxMessageEntity.create(input);

    await client.outboxMessage.create({
      data: {
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
            AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= NOW())
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
   * Keeps a targeted-reanalysis request and checkpoint observable while its command publication is retrying or exhausted.
   * This update intentionally runs in the same outbox transaction as `markFailure`, so an outbox message entering DLQ cannot leave the request appearing queued.
   *
   * @param tx - Prisma transaction shared with the outbox failure update.
   * @param requestId - Targeted-reanalysis request identifier represented by the message.
   * @param attempts - Updated API-side publication-attempt count.
   * @param terminalFailureCode - Safe failure code when retries are exhausted; null while retryable.
   * @returns A promise that resolves after request and checkpoint state are synchronized.
   */
  async recordTargetedReanalysisPublishFailure(
    tx: Prisma.TransactionClient,
    requestId: string,
    attempts: number,
    terminalFailureCode: string | null,
  ): Promise<void> {
    await tx.targetedReanalysisRequest.updateMany({
      where: {
        id: requestId,
        state: {
          in: [
            TARGETED_REANALYSIS_REQUEST_STATES.queued,
            TARGETED_REANALYSIS_REQUEST_STATES.dispatched,
          ],
        },
      },
      data: {
        apiPublishAttempts: attempts,
        ...(terminalFailureCode
          ? {
              state: TARGETED_REANALYSIS_REQUEST_STATES.dlq,
              safeFailureCode: terminalFailureCode,
            }
          : {}),
      },
    });
    await tx.targetedReanalysisCheckpoint.updateMany({
      where: { requestId },
      data: {
        apiPublishAttempts: attempts,
        ...(terminalFailureCode
          ? {
              state: TARGETED_REANALYSIS_CHECKPOINT_STATES.dlq,
              safeFailureCode: terminalFailureCode,
            }
          : {}),
      },
    });
  }

  /**
   * Atomically reserves one of an organization's targeted-reanalysis worker slots before AMQP publication.
   * The organization-scoped PostgreSQL advisory lock serializes competing reservations for the same tenant without globally serializing unrelated organizations.
   * Capacity is enforced by `TARGETED_REANALYSIS_CAPACITY_POLICY.maxRunningPerOrganization` rather than by this method assuming a hard-coded slot count.
   *
   * @param tx - Prisma transaction used for the organization-scoped advisory lock and state transition.
   * @param requestId - Targeted-reanalysis request that should be dispatched.
   * @returns True when the request is already dispatched or successfully reserved; otherwise false.
   */
  async reserveTargetedReanalysisDispatch(
    tx: Prisma.TransactionClient,
    requestId: string,
  ): Promise<boolean> {
    const request = await tx.targetedReanalysisRequest.findUnique({
      where: { id: requestId },
      select: { organizationId: true, state: true },
    });
    if (!request) return false;
    if (request.state === TARGETED_REANALYSIS_REQUEST_STATES.dispatched) {
      return true;
    }
    if (request.state !== TARGETED_REANALYSIS_REQUEST_STATES.queued) {
      return false;
    }

    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${request.organizationId}))
    `;
    const reservedCount = await tx.targetedReanalysisRequest.count({
      where: {
        organizationId: request.organizationId,
        state: {
          in: [
            TARGETED_REANALYSIS_REQUEST_STATES.dispatched,
            TARGETED_REANALYSIS_REQUEST_STATES.running,
          ],
        },
      },
    });
    if (
      reservedCount >=
      TARGETED_REANALYSIS_CAPACITY_POLICY.maxRunningPerOrganization
    ) {
      return false;
    }

    const claimed = await tx.targetedReanalysisRequest.updateMany({
      where: {
        id: requestId,
        state: TARGETED_REANALYSIS_REQUEST_STATES.queued,
      },
      data: { state: TARGETED_REANALYSIS_REQUEST_STATES.dispatched },
    });
    if (claimed.count === 1) {
      await tx.targetedReanalysisCheckpoint.updateMany({
        where: { requestId },
        data: { state: TARGETED_REANALYSIS_CHECKPOINT_STATES.dispatched },
      });
    }
    return claimed.count === 1;
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
   * Resets a DLQ message to a clean pending state so the publisher can replay it.
   *
   * @param id - Outbox message identifier to reset.
   * @returns A promise that resolves after retry metadata is cleared.
   */
  async resetMessageForReplay(id: string): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { id },
      data: {
        status: toPrismaOutboxStatus(OUTBOX_STATUSES.pending),
        attempts: 0,
        nextAttemptAt: null,
        errorMessage: null,
      },
    });
  }

  /**
   * Permanently removes an outbox message by identifier.
   *
   * @param id - Outbox message identifier to delete.
   * @returns A promise that resolves after the row is removed.
   */
  async deleteMessage(id: string): Promise<void> {
    await this.prisma.outboxMessage.delete({
      where: { id },
    });
  }
}
