import { Injectable, HttpStatus } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { isRetiredOutboxEventType } from "./retired-event-policy.js";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";
import {
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_ROOT_COMMAND_TYPES,
  ROOT_CAPACITY_REASONS,
  ROOT_CAPACITY_ID,
} from "@lcsp/contracts/assessment-domain";
import {
  OUTBOX_AUDIT_EVENT_TYPES,
  OUTBOX_AGGREGATE_TYPES,
  OUTBOX_ERROR_CODES,
  OUTBOX_STATUSES,
} from "@lcsp/contracts/outbox";
import { OutboxRepository } from "./outbox.repository.js";
import { AuditWriterService } from "../audit/audit-writer.service.js";
import { OutboxMessageEntity } from "./outbox-message.entity.js";
import { problemException } from "../http/filters/error.factory.js";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import {
  fromPrismaRepositoryScanJobStatus,
  toPrismaOutboxStatus,
} from "../../infrastructure/prisma/prisma-enum-mappers.js";

/**
 * Implements operator workflows for inspecting, replaying, and discarding outbox DLQ messages.
 */
@Injectable()
export class OutboxDlqService {
  /**
   * Creates the DLQ service with persistence, audit, and aggregate-state dependencies.
   *
   * @param outboxRepository - Repository used to query and mutate outbox messages.
   * @param auditWriter - Audit service used to record operator replay and discard decisions.
   * @param prisma - Prisma service used to validate the current state of replay targets.
   */
  constructor(
    private readonly outboxRepository: OutboxRepository,
    private readonly auditWriter: AuditWriterService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Retrieves all outbox messages currently in the dead-letter queue.
   *
   * @returns DLQ messages together with their total count.
   */
  async getDlqMessages(): Promise<{
    messages: OutboxMessageEntity[];
    count: number;
  }> {
    const messages = await this.outboxRepository.findDlqMessages();
    return { messages, count: messages.length };
  }

  /**
   * Business purpose: Atomically validate replay eligibility, reset outbox and admission state, and record operator audit.
   * Business rules:
   * - A DLQ message must only transition to PENDING (or OWNED_PENDING via isolation trigger) if it is currently in DLQ status.
   * - A crash-quarantined Root command requires ACTIVE assessment lifecycle, FAILED runtime execution state, no active lease, no held physical slot, and errorMessage equal to ROOT_CAPACITY_REASONS.fenced.
   * - Root commands require their admission request to be reset atomically using a fresh database clock timestamp.
   * - Retired outbox events and completed or failed repository scan jobs are never replayable.
   * - Positive replay audit (dlqReplayed) must commit atomically with the outbox state transition. If audit persistence fails, the entire replay transaction rolls back.
   * - Denied replays do not mutate state and persist a denial audit event (dlqReplayDenied) outside the replay transaction.
   * Execution flow:
   * 1. Start a transaction using the application Prisma client.
   * 2. Lock the global capacity row (AssessmentRootCapacity) FOR UPDATE to serialize with admission, quiescence and concurrent replays/discards.
   * 3. Read and lock the target OutboxMessage row FOR UPDATE.
   * 4. Verify message exists and is in DLQ status (throw 404 dlqMessageNotFound if missing or not DLQ).
   * 5. Validate aggregate replay safety under the active transaction (retired check, Root lifecycle/lease/slot check, scan job check).
   * 6. If Root command, atomically reset the AssessmentRootAdmissionRequest row; fail closed if not updated.
   * 7. Conditionally transition OutboxMessage from DLQ to PENDING.
   * 8. Persist OUTBOX_AUDIT_EVENT_TYPES.dlqReplayed using auditWriter.writeInTx(..., tx).
   * 9. Commit transaction.
   * 10. If unsafe target exception is caught, write OUTBOX_AUDIT_EVENT_TYPES.dlqReplayDenied via auditWriter.write() and rethrow.
   * Failure cases:
   * - Missing or non-DLQ message raises 404 NOT FOUND (no audit).
   * - Unsafe target raises 409 CONFLICT and records denial audit.
   * - Injected audit failure or DB error aborts transaction; no outbox or admission mutation survives.
   * Side effects:
   * - Resets outbox message and admission request to pending delivery state; records immutable audit event.
   */
  async replayMessage(
    id: string,
    actorId: string,
    correlationId: string,
  ): Promise<void> {
    let messageSnapshot: { eventType: string; aggregateId: string } | undefined;
    try {
      await this.prisma.$transaction(async (tx) => {
        // Step 1: Lock global capacity row to serialize with admission, quiescence and concurrent replays/discards.
        await tx.$executeRaw`
          INSERT INTO "AssessmentRootCapacity" ("id", "desired", "effective", "policy", "reason", "updatedAt")
          VALUES (${ROOT_CAPACITY_ID}, 1, 0, '{}'::jsonb, 'INITIAL', clock_timestamp())
          ON CONFLICT ("id") DO NOTHING
        `;
        await tx.$queryRaw`
          SELECT "id" FROM "AssessmentRootCapacity" WHERE "id" = ${ROOT_CAPACITY_ID} FOR UPDATE
        `;

        // Step 2: Read and lock current outbox message
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            status: string;
            eventType: string;
            aggregateType: string;
            aggregateId: string;
            errorMessage: string | null;
          }>
        >`
          SELECT "id", "status"::text AS "status", "eventType", "aggregateType"::text AS "aggregateType",
                 "aggregateId", "errorMessage"
          FROM "OutboxMessage" WHERE "id" = ${id} FOR UPDATE
        `;
        const message = rows[0];
        if (!message || message.status !== OUTBOX_STATUSES.dlq) {
          throw problemException(
            OUTBOX_ERROR_CODES.dlqMessageNotFound,
            correlationId,
            {
              status: HttpStatus.NOT_FOUND,
            },
          );
        }
        messageSnapshot = {
          eventType: message.eventType,
          aggregateId: message.aggregateId,
        };

        // Step 3: Validate replay safety under the lock
        await this.assertReplayTargetIsSafeInTx(tx, message, correlationId);

        // Step 4: For Root commands, atomically reset admission intent
        if (
          message.eventType === ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED
        ) {
          const admission = await tx.assessmentRootAdmissionRequest.findUnique({
            where: { commandId: message.id },
          });
          if (!admission || admission.assessmentId !== message.aggregateId) {
            this.unsafeReplay(correlationId);
          }
          const updatedAdmission = await tx.$executeRaw`
            UPDATE "AssessmentRootAdmissionRequest" SET
              "completedAt" = NULL,
              "admittedRunId" = NULL,
              "deliveredAt" = NULL,
              "requestedAt" = clock_timestamp()
            WHERE "commandId" = ${message.id}
              AND "assessmentId" = ${message.aggregateId}
              AND NOT EXISTS (
                SELECT 1 FROM "AssessmentRootExecutionSlot" s
                WHERE s."assessmentId" = ${message.aggregateId} AND s."releasedAt" IS NULL
              )
          `;
          if (updatedAdmission === 0) {
            this.unsafeReplay(correlationId);
          }
        }

        // Step 5: Conditionally transition outbox message from DLQ to PENDING
        const updatedMessage = await tx.$executeRaw`
          UPDATE "OutboxMessage" SET
            "status" = ${toPrismaOutboxStatus(OUTBOX_STATUSES.pending)}::"OutboxStatus",
            "attempts" = 0,
            "nextAttemptAt" = NULL,
            "errorMessage" = NULL
          WHERE "id" = ${message.id}
            AND "status" = ${toPrismaOutboxStatus(OUTBOX_STATUSES.dlq)}::"OutboxStatus"
        `;
        if (updatedMessage === 0) {
          throw problemException(
            OUTBOX_ERROR_CODES.dlqMessageNotFound,
            correlationId,
            {
              status: HttpStatus.NOT_FOUND,
            },
          );
        }

        // Step 6: Atomically persist positive dlqReplayed audit event inside the transaction
        await this.auditWriter.writeInTx(
          {
            eventType: OUTBOX_AUDIT_EVENT_TYPES.dlqReplayed,
            actorId,
            resourceType: AUDIT_RESOURCE_TYPES.outbox,
            resourceId: id,
            decision: AUDIT_DECISIONS.allow,
            correlationId,
            payload: {
              originalEventType: message.eventType,
              aggregateId: message.aggregateId,
            },
          },
          tx,
        );
      });
    } catch (error) {
      if (
        messageSnapshot &&
        error &&
        typeof error === "object" &&
        "response" in error &&
        (error as { response?: { problem?: { code?: string } } }).response
          ?.problem?.code === OUTBOX_ERROR_CODES.dlqReplayUnsafeTarget
      ) {
        await this.auditWriter.write({
          eventType: OUTBOX_AUDIT_EVENT_TYPES.dlqReplayDenied,
          actorId,
          resourceType: AUDIT_RESOURCE_TYPES.outbox,
          resourceId: id,
          decision: AUDIT_DECISIONS.deny,
          correlationId,
          reasonCode: OUTBOX_ERROR_CODES.dlqReplayUnsafeTarget,
          payload: {
            originalEventType: messageSnapshot.eventType,
            aggregateId: messageSnapshot.aggregateId,
          },
        });
      }
      throw error;
    }
  }

  /**
   * Business purpose: Permanently discard or tombstone an operator-selected DLQ message and audit the decision.
   * Business rules:
   * - Only a message currently in DLQ status can be discarded.
   * - Commands referenced by durable admission bookkeeping become cancelled tombstones; unreferenced messages are physically removed.
   * - Discard audit (dlqDiscarded) must commit atomically with message deletion or tombstone. If audit fails, discard rolls back.
   * - Competing replay and discard serialize under the global capacity and outbox row locks.
   * Execution flow:
   * 1. Start a transaction using the application Prisma client.
   * 2. Lock the global capacity row (AssessmentRootCapacity) FOR UPDATE.
   * 3. Read and lock target OutboxMessage row FOR UPDATE.
   * 4. Verify message exists and is in DLQ status (throw 404 dlqMessageNotFound if missing or not DLQ).
   * 5. Check whether durable admission bookkeeping exists for this command.
   * 6. Conditionally update status to CANCELLED (if intent exists) or delete the row (if unreferenced).
   * 7. Write OUTBOX_AUDIT_EVENT_TYPES.dlqDiscarded using auditWriter.writeInTx(..., tx).
   * 8. Commit transaction.
   * Failure cases:
   * - Message missing or not in DLQ raises 404 NOT FOUND.
   * - Injected audit failure or DB error aborts transaction; no discard or tombstone survives.
   * Side effects:
   * - Removes DLQ visibility; records immutable discard audit.
   */
  async deleteMessage(
    id: string,
    actorId: string,
    correlationId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Step 1: Acquire global capacity lock to serialize with admission, quiescence and replay
      await tx.$executeRaw`
        INSERT INTO "AssessmentRootCapacity" ("id", "desired", "effective", "policy", "reason", "updatedAt")
        VALUES (${ROOT_CAPACITY_ID}, 1, 0, '{}'::jsonb, 'INITIAL', clock_timestamp())
        ON CONFLICT ("id") DO NOTHING
      `;
      await tx.$queryRaw`
        SELECT "id" FROM "AssessmentRootCapacity" WHERE "id" = ${ROOT_CAPACITY_ID} FOR UPDATE
      `;

      // Step 2: Read and lock current outbox message
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          status: string;
          eventType: string;
          aggregateType: string;
          aggregateId: string;
        }>
      >`
        SELECT "id", "status"::text AS "status", "eventType", "aggregateType"::text AS "aggregateType", "aggregateId"
        FROM "OutboxMessage" WHERE "id" = ${id} FOR UPDATE
      `;
      const message = rows[0];
      if (!message || message.status !== OUTBOX_STATUSES.dlq) {
        throw problemException(
          OUTBOX_ERROR_CODES.dlqMessageNotFound,
          correlationId,
          {
            status: HttpStatus.NOT_FOUND,
          },
        );
      }

      // Step 3: Check for durable admission bookkeeping
      const intent = await tx.assessmentRootAdmissionRequest.findUnique({
        where: { commandId: id },
        select: { commandId: true },
      });

      // Step 4: Conditionally tombstone or delete
      if (intent) {
        const updated = await tx.$executeRaw`
          UPDATE "OutboxMessage" SET
            "status" = ${toPrismaOutboxStatus(OUTBOX_STATUSES.cancelled)}::"OutboxStatus"
          WHERE "id" = ${id} AND "status" = ${toPrismaOutboxStatus(OUTBOX_STATUSES.dlq)}::"OutboxStatus"
        `;
        if (updated === 0) {
          throw problemException(
            OUTBOX_ERROR_CODES.dlqMessageNotFound,
            correlationId,
            { status: HttpStatus.NOT_FOUND },
          );
        }
      } else {
        const deleted = await tx.$executeRaw`
          DELETE FROM "OutboxMessage"
          WHERE "id" = ${id} AND "status" = ${toPrismaOutboxStatus(OUTBOX_STATUSES.dlq)}::"OutboxStatus"
        `;
        if (deleted === 0) {
          throw problemException(
            OUTBOX_ERROR_CODES.dlqMessageNotFound,
            correlationId,
            { status: HttpStatus.NOT_FOUND },
          );
        }
      }

      // Step 5: Atomically persist discard audit event inside the transaction
      await this.auditWriter.writeInTx(
        {
          eventType: OUTBOX_AUDIT_EVENT_TYPES.dlqDiscarded,
          actorId,
          resourceType: AUDIT_RESOURCE_TYPES.outbox,
          resourceId: id,
          decision: AUDIT_DECISIONS.allow,
          correlationId,
          payload: {
            originalEventType: message.eventType,
            aggregateId: message.aggregateId,
          },
        },
        tx,
      );
    });
  }

  /**
   * Business purpose: Verify that aggregate state under transaction lock permits explicit operator replay without duplicating work.
   * Business rules:
   * - Retired traffic and terminal repository jobs remain non-replayable.
   * - A crash-quarantined Root requires FAILED runtime, ACTIVE Assessment, no lease and no held physical slot.
   * Execution flow:
   * 1. Reject retired traffic.
   * 2. Validate Root recovery or existing repository-job eligibility under the transaction.
   * Failure cases:
   * - Unsafe current state throws dlqReplayUnsafeTarget conflict.
   * Side effects:
   * - Reads canonical state under the transaction; no lease, model invocation, checkpoint or legal decision is created.
   */
  private async assertReplayTargetIsSafeInTx(
    tx: Prisma.TransactionClient,
    message: {
      eventType: string;
      aggregateId: string;
      aggregateType: string;
      errorMessage: string | null;
    },
    correlationId: string,
  ): Promise<void> {
    // CUTOVER fence: retired V1 traffic is never replayable, regardless of its aggregate's state.
    if (isRetiredOutboxEventType(message.eventType)) {
      this.unsafeReplay(correlationId);
    }
    if (message.eventType === ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED) {
      const assessment = await tx.assessment.findUnique({
        where: { id: message.aggregateId },
        include: { runtime: true },
      });
      const held = await tx.assessmentRootExecutionSlot.count({
        where: { assessmentId: message.aggregateId, releasedAt: null },
      });
      if (
        message.errorMessage !== ROOT_CAPACITY_REASONS.fenced ||
        assessment?.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.ACTIVE ||
        assessment.runtime?.executionState !== AGENT_EXECUTION_STATES.FAILED ||
        assessment.runtime.leaseToken ||
        held > 0
      ) {
        this.unsafeReplay(correlationId);
      }
      return;
    }
    if (message.aggregateType === OUTBOX_AGGREGATE_TYPES.repositoryScanJob) {
      const job = await tx.repositoryScanJob.findUnique({
        where: { id: message.aggregateId },
        select: { status: true },
      });
      const status = job ? fromPrismaRepositoryScanJobStatus(job.status) : null;
      if (
        status === REPOSITORY_SCAN_JOB_STATUSES.completed ||
        status === REPOSITORY_SCAN_JOB_STATUSES.failed
      ) {
        this.unsafeReplay(correlationId);
      }
      return;
    }
  }

  /**
   * Business purpose: Raise the standardized conflict response when operator replay targets an ineligible aggregate state.
   * Business rules:
   * - Conflict error code dlqReplayUnsafeTarget must be emitted with HTTP 409 status code.
   * Execution flow:
   * 1. Construct and throw the standardized problem exception.
   * Failure cases:
   * - Always throws problemException with CONFLICT status.
   * Side effects:
   * - Pure error construction; no database mutations or side effects.
   */
  private unsafeReplay(correlationId: string): never {
    throw problemException(
      OUTBOX_ERROR_CODES.dlqReplayUnsafeTarget,
      correlationId,
      {
        status: HttpStatus.CONFLICT,
      },
    );
  }
}
