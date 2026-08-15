import { Injectable, HttpStatus } from "@nestjs/common";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";
import {
  OUTBOX_AUDIT_EVENT_TYPES,
  OUTBOX_AGGREGATE_TYPES,
  OUTBOX_ERROR_CODES,
  OUTBOX_STATUSES,
} from "@lcsp/contracts/outbox";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";
import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";
import { OutboxRepository } from "./outbox.repository.js";
import { AuditWriterService } from "../audit/audit-writer.service.js";
import { OutboxMessageEntity } from "./outbox-message.entity.js";
import { problemException } from "../problems/problem-factory.js";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import {
  fromPrismaEvidenceAcceptanceStatus,
  fromPrismaRepositoryScanJobStatus,
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
   * Validates a DLQ message for safe replay, resets it to pending, and audits the decision.
   *
   * @param id - Outbox message identifier to replay.
   * @param actorId - Operator user identifier performing the replay.
   * @param organizationId - Organization context of the operator action.
   * @param correlationId - Correlation identifier used for errors and audit tracing.
   * @returns A promise that resolves after the message is reset and audited.
   */
  async replayMessage(
    id: string,
    actorId: string,
    organizationId: string,
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
        organizationId,
        resourceType: AUDIT_RESOURCE_TYPES.outbox,
        resourceId: id,
        decision: AUDIT_DECISIONS.deny,
        correlationId,
        reasonCode: OUTBOX_ERROR_CODES.dlqReplayUnsafeTarget,
        payload: {
          originalEventType: message.eventType,
          aggregateId: message.aggregateId,
          replayAuthority: PBAC_ACTIONS.outboxReplay,
        },
      });
      throw error;
    }
    await this.outboxRepository.resetMessageForReplay(id);

    await this.auditWriter.write({
      eventType: OUTBOX_AUDIT_EVENT_TYPES.dlqReplayed,
      actorId,
      organizationId,
      resourceType: AUDIT_RESOURCE_TYPES.outbox,
      resourceId: id,
      decision: AUDIT_DECISIONS.allow,
      correlationId,
      payload: {
        originalEventType: message.eventType,
        aggregateId: message.aggregateId,
        replayAuthority: PBAC_ACTIONS.outboxReplay,
      },
    });
  }

  /**
   * Permanently removes a DLQ message and records the discard action in the audit log.
   *
   * @param id - Outbox message identifier to delete.
   * @param actorId - Operator user identifier performing the deletion.
   * @param organizationId - Organization context of the operator action.
   * @param correlationId - Correlation identifier used for errors and audit tracing.
   * @returns A promise that resolves after deletion and audit persistence complete.
   */
  async deleteMessage(
    id: string,
    actorId: string,
    organizationId: string,
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
      organizationId,
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
   * Rejects replay when the target aggregate has already reached a terminal state that must not be repeated.
   *
   * @param message - DLQ message whose aggregate target should be checked.
   * @param correlationId - Correlation identifier used when reporting an unsafe replay.
   * @returns A promise that resolves when replay is considered safe.
   */
  private async assertReplayTargetIsSafe(
    message: OutboxMessageEntity,
    correlationId: string,
  ): Promise<void> {
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

    if (
      message.aggregateType === OUTBOX_AGGREGATE_TYPES.technicalEvidenceReport
    ) {
      const report = await this.prisma.technicalEvidenceReport.findUnique({
        where: { id: message.aggregateId },
        select: { status: true },
      });
      const status = report
        ? fromPrismaEvidenceAcceptanceStatus(report.status)
        : null;
      if (status === TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted) {
        this.unsafeReplay(correlationId);
      }
      return;
    }

    if (message.aggregateType === OUTBOX_AGGREGATE_TYPES.technicalProfile) {
      const profile = await this.prisma.technicalProfile.findUnique({
        where: { id: message.aggregateId },
        select: { status: true },
      });
      const status = profile
        ? fromPrismaEvidenceAcceptanceStatus(profile.status)
        : null;
      if (status === TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted) {
        this.unsafeReplay(correlationId);
      }
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
