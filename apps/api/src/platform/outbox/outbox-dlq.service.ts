import { Injectable, HttpStatus } from "@nestjs/common";
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
import { fromPrismaRepositoryScanJobStatus } from "../../infrastructure/prisma/prisma-enum-mappers.js";

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
   * Validates a DLQ message for safe replay, resets it to pending, and audits the decision.
   *
   * @param id - Outbox message identifier to replay.
   * @param actorId - Operator user identifier performing the replay.
   * @param correlationId - Correlation identifier used for errors and audit tracing.
   * @returns A promise that resolves after the message is reset and audited.
   */
  async replayMessage(
    id: string,
    actorId: string,
    correlationId: string,
  ): Promise<void> {
    const message = await this.outboxRepository.findMessageById(id);
    if (!message || message.status !== OUTBOX_STATUSES.dlq) {
      throw problemException(
        OUTBOX_ERROR_CODES.dlqMessageNotFound,
        correlationId,
        {
          status: HttpStatus.NOT_FOUND,
        },
      );
    }

    try {
      await this.assertReplayTargetIsSafe(message, correlationId);
    } catch (error) {
      await this.auditWriter.write({
        eventType: OUTBOX_AUDIT_EVENT_TYPES.dlqReplayDenied,
        actorId,
        resourceType: AUDIT_RESOURCE_TYPES.outbox,
        resourceId: id,
        decision: AUDIT_DECISIONS.deny,
        correlationId,
        reasonCode: OUTBOX_ERROR_CODES.dlqReplayUnsafeTarget,
        payload: {
          originalEventType: message.eventType,
          aggregateId: message.aggregateId,
        },
      });
      throw error;
    }
    await this.outboxRepository.resetMessageForReplay(id);

    await this.auditWriter.write({
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
    });
  }

  /**
   * Permanently removes a DLQ message and records the discard action in the audit log.
   *
   * @param id - Outbox message identifier to delete.
   * @param actorId - Operator user identifier performing the deletion.
   * @param correlationId - Correlation identifier used for errors and audit tracing.
   * @returns A promise that resolves after deletion and audit persistence complete.
   */
  async deleteMessage(
    id: string,
    actorId: string,
    correlationId: string,
  ): Promise<void> {
    const message = await this.outboxRepository.findMessageById(id);
    if (!message || message.status !== OUTBOX_STATUSES.dlq) {
      throw problemException(
        OUTBOX_ERROR_CODES.dlqMessageNotFound,
        correlationId,
        {
          status: HttpStatus.NOT_FOUND,
        },
      );
    }

    await this.outboxRepository.deleteMessage(id);

    await this.auditWriter.write({
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
    });
  }

  /**
   * Business purpose: Permit explicit operator retry only when its aggregate cannot duplicate live or completed work.
   * Business rules:
   * - Retired traffic and terminal repository jobs remain non-replayable.
   * - A crash-quarantined Root requires FAILED runtime, ACTIVE Assessment, no lease and no held physical slot.
   * Execution flow: 1. Reject retired traffic; 2. validate Root recovery or existing repository-job eligibility.
   * Failure cases:
   * - Unsafe current state returns the existing DLQ conflict and the caller records denial audit.
   * Side effects:
   * - Reads canonical state only; no lease, model invocation, checkpoint or legal decision is created here.
   */
  private async assertReplayTargetIsSafe(
    message: OutboxMessageEntity,
    correlationId: string,
  ): Promise<void> {
    // CUTOVER fence: retired V1 traffic is never replayable, regardless of its aggregate's state.
    if (isRetiredOutboxEventType(message.eventType)) {
      this.unsafeReplay(correlationId);
    }
    if (message.eventType === ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED) {
      const assessment = await this.prisma.assessment.findUnique({
        where: { id: message.aggregateId },
        include: { runtime: true },
      });
      const held = await this.prisma.assessmentRootExecutionSlot.count({
        where: { assessmentId: message.aggregateId, releasedAt: null },
      });
      if (
        message.errorMessage !== ROOT_CAPACITY_REASONS.fenced ||
        assessment?.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.ACTIVE ||
        assessment.runtime?.executionState !== AGENT_EXECUTION_STATES.FAILED ||
        assessment.runtime.leaseToken ||
        held
      )
        this.unsafeReplay(correlationId);
      return;
    }
    if (message.aggregateType === OUTBOX_AGGREGATE_TYPES.repositoryScanJob) {
      const job = await this.prisma.repositoryScanJob.findUnique({
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
   * Raises the standardized conflict used when a DLQ replay would target an unsafe terminal aggregate.
   *
   * @param correlationId - Correlation identifier attached to the problem response.
   * @returns Never; this helper always throws.
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
