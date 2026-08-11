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

@Injectable()
export class OutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Inserts a new pending OutboxMessage; the publisher poller picks it up separately. */
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
   * Selects up to `batchSize` pending messages with SELECT ... FOR UPDATE SKIP LOCKED,
   * then runs `handler` before committing — so the row lock is held for the duration of
   * the publish attempt, preventing a second instance from picking up the same message.
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
   * Keeps a targeted-reanalysis request observable while its command is being
   * published. This is deliberately in the same outbox transaction as
   * `markFailure`, so an outbox DLQ cannot leave a request appearing queued.
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
   * Reserves one of an organization's two targeted-reanalysis worker slots
   * before AMQP publication. The advisory lock serializes reservations for one
   * organization without globally serializing unrelated tenants.
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

  async deleteMessage(id: string): Promise<void> {
    await this.prisma.outboxMessage.delete({
      where: { id },
    });
  }
}
