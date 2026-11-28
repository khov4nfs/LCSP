import { isRetiredOutboxEventType } from "./retired-event-policy.js";
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  type OutboxAggregateType,
  OUTBOX_STATUSES,
  type OutboxMessageInput,
  type OutboxStatus,
} from "@lcsp/contracts/outbox";
import { RBAC_OUTBOX_EVENT_TYPES } from "@lcsp/contracts/rbac";

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
import { AGENT_EXECUTION_STATES } from "@lcsp/contracts/assessment";

export interface OutboxDlqRow {
  id: string;
  status: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  errorMessage: string | null;
}

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
   * Business purpose: Publish durable events through their authorized deployment without losing broker confirmation.
   * Business rules:
   * - Legacy publishers cannot select OWNED_PENDING; isolated Assessment events require their enrolled DB login.
   * - Every retry respects its UTC backoff and row locks remain held until the publication handler finishes.
   * Execution flow:
   * 1. Lock a bounded, oldest-first batch of ordinary or authorized isolated deliveries with SKIP LOCKED.
   * 2. Rehydrate and handle each event in that transaction, or return null for an empty batch.
   * Failure cases:
   * - A handler/DB failure rolls back publication state; redelivery retains the original idempotency identity.
   * Side effects:
   * - Holds only the selected outbox row locks; the caller confirms broker publication before marking success.
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
        WHERE (
          status = ${OUTBOX_STATUSES.pending}
          OR (
            status = ${OUTBOX_STATUSES.failed}
            -- Prisma persists DateTime as UTC in a timestamp-without-zone
            -- column. Compare against a UTC timestamp without zone to avoid
            -- treating future retries as due on servers with a non-UTC TZ.
            AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= (NOW() AT TIME ZONE 'UTC'))
          )
          OR (
            status = ${OUTBOX_STATUSES.ownedPending}
            AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= (NOW() AT TIME ZONE 'UTC'))
            AND EXISTS (
              SELECT 1 FROM "AssessmentExecutionIsolation" isolation
              WHERE isolation."assessmentId" = "OutboxMessage"."aggregateId"
                AND isolation."writerRole" = session_user
            )
          )
        )
          AND "eventType" <> ${RBAC_OUTBOX_EVENT_TYPES.authorizationDecisionAuditFallback}
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
   * Business purpose: Recover one bounded batch of local-only events independently from broker delivery backlog.
   * Business rules:
   * - Only the requested event type is locked; retry eligibility and SKIP LOCKED semantics match ordinary delivery.
   * Execution flow:
   * 1. Select eligible rows for the exact local event type under oldest-first row locks.
   * 2. Rehydrate the rows and invoke the handler in the same transaction.
   * Failure cases:
   * - Handler or persistence failure rolls back the local batch without affecting broker-bound messages.
   * Side effects:
   * - Holds and updates only the selected local-event outbox rows in one database transaction.
   */
  async withPendingBatchByEventType<T>(
    eventType: string,
    batchSize: number,
    handler: (
      messages: OutboxMessageEntity[],
      tx: Prisma.TransactionClient,
    ) => Promise<T>,
  ): Promise<T | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<OutboxRow[]>`
        SELECT * FROM "OutboxMessage"
        WHERE "eventType" = ${eventType}
          AND (
            status = ${OUTBOX_STATUSES.pending}
            OR (
              status = ${OUTBOX_STATUSES.failed}
              AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= (NOW() AT TIME ZONE 'UTC'))
            )
          )
        ORDER BY "createdAt" ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      `;
      if (rows.length === 0) return null;
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
   * - The DLQ service retains authorization and lifecycle guards; replay cannot release physical Root occupancy.
   * - Only a quiescent Root command may reopen its operational admission intent; accepted domain work is unchanged.
   * - Explicit replay receives a new database-clock request time so an older completed turn cannot consume the new intent.
   * - Replay is strictly conditional on current DLQ status; non-DLQ messages reject.
   * Execution flow:
   * 1. Lock the global capacity row and target outbox message FOR UPDATE.
   * 2. Verify current status is DLQ (fail closed if not).
   * 3. For Root commands, reset admission bookkeeping; fail closed if a physical slot is held or intent missing.
   * 4. Conditionally transition outbox message from DLQ to PENDING.
   * Failure cases:
   * - Missing message, non-DLQ status, live slot or persistence errors roll back atomically.
   * Side effects:
   * - Updates outbox and admission bookkeeping; caller preserves operator audit.
   */
  async resetMessageForReplay(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const run = async (client: Prisma.TransactionClient) => {
      // Serialize replay with admission whenever physical authority has been initialized.
      await client.$executeRaw`
        INSERT INTO "AssessmentRootCapacity" ("id", "desired", "effective", "policy", "reason", "updatedAt")
        VALUES (${ROOT_CAPACITY_ID}, 1, 0, '{}'::jsonb, 'INITIAL', clock_timestamp())
        ON CONFLICT ("id") DO NOTHING
      `;
      await client.$queryRaw`SELECT "id" FROM "AssessmentRootCapacity" WHERE "id" = ${ROOT_CAPACITY_ID} FOR UPDATE`;
      const [msg] = await client.$queryRaw<OutboxRow[]>`
        SELECT * FROM "OutboxMessage" WHERE "id" = ${id} FOR UPDATE
      `;
      if (!msg || msg.status !== OUTBOX_STATUSES.dlq) {
        throw new Error(`OUTBOX_MESSAGE_NOT_DLQ: ${id}`);
      }
      const isRoot =
        msg.eventType === ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED;
      if (isRoot) {
        const updated = await client.$executeRaw`
          UPDATE "AssessmentRootAdmissionRequest" r SET "completedAt" = NULL,
            "admittedRunId" = NULL, "deliveredAt" = NULL,
            "requestedAt" = clock_timestamp()
          WHERE r."commandId" = ${id} AND NOT EXISTS (
            SELECT 1 FROM "AssessmentRootExecutionSlot" s
            WHERE s."assessmentId" = r."assessmentId" AND s."releasedAt" IS NULL)`;
        if (updated === 0) {
          throw new Error(`ROOT_ADMISSION_RESET_FAILED: ${id}`);
        }
      }
      const transitioned = await client.$executeRaw`
        UPDATE "OutboxMessage" SET
          "status" = ${toPrismaOutboxStatus(OUTBOX_STATUSES.pending)}::"OutboxStatus",
          "attempts" = 0,
          "nextAttemptAt" = NULL,
          "errorMessage" = NULL
        WHERE "id" = ${id} AND "status" = ${toPrismaOutboxStatus(OUTBOX_STATUSES.dlq)}::"OutboxStatus"
      `;
      if (transitioned === 0) {
        throw new Error(`OUTBOX_MESSAGE_NOT_DLQ: ${id}`);
      }
    };
    if (tx) {
      await run(tx);
    } else {
      await this.prisma.$transaction(run);
    }
  }

  /**
   * Business purpose: Discard an operator-selected DLQ delivery while retaining physical Root authority and audit links.
   * Business rules:
   * - Root commands referenced by admission history become cancelled tombstones; their slots and history cannot cascade away.
   * - Discard strictly rejects if physical execution slots are held or runtime is active/leased.
   * - Unreferenced transport messages keep the existing physical deletion behavior.
   * - Discard is strictly conditional on current DLQ status; non-DLQ messages reject.
   * Execution flow:
   * 1. Lock the global capacity row and target outbox message FOR UPDATE.
   * 2. Verify current status is DLQ (fail closed if not).
   * 3. Find admission bookkeeping and verify physical slots and runtime are completely quiescent.
   * 4. Cancel its transport record, or delete an unreferenced message.
   * Failure cases:
   * - Missing message, non-DLQ status, active execution, or database failure rejects atomically; discard never cancels a living native Root.
   * Side effects:
   * - Removes the message from DLQ visibility while preserving Root history; caller records discard audit.
   */
  async deleteMessage(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const run = async (client: Prisma.TransactionClient) => {
      await client.$executeRaw`
        INSERT INTO "AssessmentRootCapacity" ("id", "desired", "effective", "policy", "reason", "updatedAt")
        VALUES (${ROOT_CAPACITY_ID}, 1, 0, '{}'::jsonb, 'INITIAL', clock_timestamp())
        ON CONFLICT ("id") DO NOTHING
      `;
      await client.$queryRaw`SELECT "id" FROM "AssessmentRootCapacity" WHERE "id" = ${ROOT_CAPACITY_ID} FOR UPDATE`;
      const [msg] = await client.$queryRaw<OutboxRow[]>`
        SELECT * FROM "OutboxMessage" WHERE "id" = ${id} FOR UPDATE
      `;
      if (!msg || msg.status !== OUTBOX_STATUSES.dlq) {
        throw new Error(`OUTBOX_MESSAGE_NOT_DLQ: ${id}`);
      }
      const intent = await client.assessmentRootAdmissionRequest.findUnique({
        where: { commandId: id },
        select: { commandId: true, assessmentId: true },
      });
      if (intent) {
        const heldSlots = await client.assessmentRootExecutionSlot.count({
          where: {
            assessmentId: intent.assessmentId,
            releasedAt: null,
          },
        });
        const assessment = await client.assessment.findUnique({
          where: { id: intent.assessmentId },
          select: {
            runtime: {
              select: {
                executionState: true,
                leaseToken: true,
              },
            },
          },
        });
        if (
          heldSlots > 0 ||
          assessment?.runtime?.executionState ===
            AGENT_EXECUTION_STATES.RUNNING ||
          assessment?.runtime?.leaseToken != null
        ) {
          throw new Error("ROOT_EXECUTION_ACTIVE_CANNOT_DISCARD");
        }
        const updated = await client.$executeRaw`
          UPDATE "OutboxMessage" SET "status" = ${toPrismaOutboxStatus(OUTBOX_STATUSES.cancelled)}::"OutboxStatus"
          WHERE "id" = ${id} AND "status" = ${toPrismaOutboxStatus(OUTBOX_STATUSES.dlq)}::"OutboxStatus"
        `;
        if (updated === 0) {
          throw new Error(`OUTBOX_MESSAGE_NOT_DLQ: ${id}`);
        }
      } else {
        const deleted = await client.$executeRaw`
          DELETE FROM "OutboxMessage" WHERE "id" = ${id} AND "status" = ${toPrismaOutboxStatus(OUTBOX_STATUSES.dlq)}::"OutboxStatus"
        `;
        if (deleted === 0) {
          throw new Error(`OUTBOX_MESSAGE_NOT_DLQ: ${id}`);
        }
      }
    };
    if (tx) {
      await run(tx);
    } else {
      await this.prisma.$transaction(run);
    }
  }

  /**
   * Business purpose: Acquire global root capacity singleton lock to serialize admission, replay, and discard.
   * Business rules:
   * - Serializes concurrent access to Root demand capacity.
   * - Must execute within the provided transaction context.
   * Execution flow:
   * 1. Upsert singleton AssessmentRootCapacity row with ON CONFLICT DO NOTHING.
   * 2. Select the capacity row FOR UPDATE to lock the capacity singleton until transaction completion.
   * Failure cases:
   * - Database connection or transaction failure aborts locking.
   * Side effects:
   * - Holds row-level exclusive lock on AssessmentRootCapacity until transaction completes.
   */
  async acquireRootCapacityLock(tx: Prisma.TransactionClient): Promise<void> {
    // Rationale (Why):
    // Centralizes capacity singleton row locking inside the persistence repository.
    // Mechanism (How):
    // Upserts singleton row then locks it FOR UPDATE to prevent race conditions.
    // Invariants (What):
    // Lock is tied strictly to the active transaction boundary.
    await tx.$executeRaw`
      INSERT INTO "AssessmentRootCapacity" ("id", "desired", "effective", "policy", "reason", "updatedAt")
      VALUES (${ROOT_CAPACITY_ID}, 1, 0, '{}'::jsonb, 'INITIAL', clock_timestamp())
      ON CONFLICT ("id") DO NOTHING
    `;
    await tx.$queryRaw`
      SELECT "id" FROM "AssessmentRootCapacity" WHERE "id" = ${ROOT_CAPACITY_ID} FOR UPDATE
    `;
  }

  /**
   * Business purpose: Lock and fetch a specific outbox message by ID with an exclusive row lock.
   * Business rules:
   * - Locks the target outbox row FOR UPDATE to prevent race conditions during DLQ review/replay/discard.
   * - Returns all metadata fields needed for safety evaluation.
   * Execution flow:
   * 1. Query OutboxMessage by ID with FOR UPDATE row lock.
   * 2. Return the locked row if found, or null if no row matches.
   * Failure cases:
   * - Database connection failure or query timeout aborts transaction.
   * Side effects:
   * - Holds row-level exclusive lock on the OutboxMessage row within the active transaction.
   */
  async lockAndGetDlqMessage(
    id: string,
    tx: Prisma.TransactionClient,
  ): Promise<OutboxDlqRow | null> {
    // Rationale (Why):
    // Isolates raw SQL message locking from application services.
    // Mechanism (How):
    // Executes SELECT FOR UPDATE on OutboxMessage within the caller's transaction.
    // Invariants (What):
    // Guarantees atomic row-level isolation while checking DLQ status.
    const rows = await tx.$queryRaw<OutboxDlqRow[]>`
      SELECT "id", "status"::text AS "status", "eventType", "aggregateType"::text AS "aggregateType",
             "aggregateId", "errorMessage"
      FROM "OutboxMessage" WHERE "id" = ${id} FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  /**
   * Business purpose: Reset durable Root admission intent bookkeeping when replaying an assessment command.
   * Business rules:
   * - Only resets admission request if no unreleased physical execution slot is held.
   * - Clears completion, delivery, and admission timestamps while refreshing requestedAt to current DB clock.
   * Execution flow:
   * 1. Update AssessmentRootAdmissionRequest matching commandId and assessmentId.
   * 2. Assert NOT EXISTS unreleased AssessmentRootExecutionSlot for the assessment.
   * 3. Return true if exactly one row was updated, false otherwise.
   * Failure cases:
   * - Database constraint violation or active slot holding aborts update.
   * Side effects:
   * - Resets admission intent state in database.
   */
  async resetRootAdmissionIntent(
    commandId: string,
    assessmentId: string,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    // Rationale (Why):
    // Encapsulates complex conditional update of admission intent in the repository layer.
    // Mechanism (How):
    // Runs an atomic UPDATE checking NOT EXISTS active unreleased slots.
    // Invariants (What):
    // Ensures replay never resets admission for an assessment actively occupying physical slots.
    const updatedCount = await tx.$executeRaw`
      UPDATE "AssessmentRootAdmissionRequest" SET
        "completedAt" = NULL,
        "admittedRunId" = NULL,
        "deliveredAt" = NULL,
        "requestedAt" = clock_timestamp()
      WHERE "commandId" = ${commandId}
        AND "assessmentId" = ${assessmentId}
        AND NOT EXISTS (
          SELECT 1 FROM "AssessmentRootExecutionSlot" s
          WHERE s."assessmentId" = ${assessmentId} AND s."releasedAt" IS NULL
        )
    `;
    return updatedCount > 0;
  }

  /**
   * Business purpose: Atomically transition an outbox message from DLQ state to PENDING state for redelivery.
   * Business rules:
   * - Transition succeeds only if current status is strictly DLQ.
   * - Resets attempts counter to 0, clears error message and nextAttemptAt.
   * Execution flow:
   * 1. Execute conditional update setting status to PENDING where id and status match.
   * 2. Return true if a row was updated, false if message was not in DLQ state.
   * Failure cases:
   * - Concurrently modified status yields 0 updated rows and returns false.
   * Side effects:
   * - Moves message to pending queue for immediate processing by publisher daemon.
   */
  async transitionDlqToPending(
    id: string,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    // Rationale (Why):
    // Decouples SQL-level state transition from service orchestration.
    // Mechanism (How):
    // Conditionally updates status from DLQ to PENDING with attempts reset.
    // Invariants (What):
    // Fails safely if the row was concurrently modified or is not in DLQ state.
    const updatedCount = await tx.$executeRaw`
      UPDATE "OutboxMessage" SET
        "status" = ${toPrismaOutboxStatus(OUTBOX_STATUSES.pending)}::"OutboxStatus",
        "attempts" = 0,
        "nextAttemptAt" = NULL,
        "errorMessage" = NULL
      WHERE "id" = ${id}
        AND "status" = ${toPrismaOutboxStatus(OUTBOX_STATUSES.dlq)}::"OutboxStatus"
    `;
    return updatedCount > 0;
  }

  /**
   * Business purpose: Mark an outbox message as CANCELLED tombstone when discarding a message with durable history.
   * Business rules:
   * - Message must currently be in DLQ status.
   * - Sets status to CANCELLED without physically deleting the row to preserve auditability.
   * Execution flow:
   * 1. Execute conditional update setting status to CANCELLED.
   * 2. Return true if updated, false if not in DLQ state.
   * Failure cases:
   * - Message missing or not in DLQ returns false.
   * Side effects:
   * - Marks message cancelled in database.
   */
  async cancelDlqMessage(
    id: string,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    // Rationale (Why):
    // Preserves cancelled outbox message tombstones in repository.
    // Mechanism (How):
    // Executes UPDATE setting status to CANCELLED if currently in DLQ.
    // Invariants (What):
    // Non-DLQ messages reject update and return false.
    const updatedCount = await tx.$executeRaw`
      UPDATE "OutboxMessage" SET
        "status" = ${toPrismaOutboxStatus(OUTBOX_STATUSES.cancelled)}::"OutboxStatus"
      WHERE "id" = ${id}
        AND "status" = ${toPrismaOutboxStatus(OUTBOX_STATUSES.dlq)}::"OutboxStatus"
    `;
    return updatedCount > 0;
  }

  /**
   * Business purpose: Physically delete an unreferenced dead-letter outbox message.
   * Business rules:
   * - Message must currently be in DLQ status.
   * - Used only when no admission request or domain history references the message.
   * Execution flow:
   * 1. Execute conditional delete where id and status match.
   * 2. Return true if deleted, false if message was not in DLQ state.
   * Failure cases:
   * - Message missing or not in DLQ returns false.
   * Side effects:
   * - Removes row from OutboxMessage table.
   */
  async deleteDlqMessage(
    id: string,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    // Rationale (Why):
    // Isolates raw SQL delete operations from business service layers.
    // Mechanism (How):
    // Deletes row only when status matches DLQ.
    // Invariants (What):
    // Does not delete active or non-DLQ messages.
    const deletedCount = await tx.$executeRaw`
      DELETE FROM "OutboxMessage"
      WHERE "id" = ${id}
        AND "status" = ${toPrismaOutboxStatus(OUTBOX_STATUSES.dlq)}::"OutboxStatus"
    `;
    return deletedCount > 0;
  }
}
