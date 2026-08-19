import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { randomUUID } from "node:crypto";

import { ASSESSMENT_STATUS_CODES } from "@lcsp/contracts/assessment";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import {
  GITHUB_INTEGRATION_ERROR_CODES,
  GITHUB_INTEGRATION_EVENT_TYPES,
  REPOSITORY_SCAN_JOB_STATUSES,
  REPOSITORY_SCAN_TRIGGER_SOURCES,
} from "@lcsp/contracts/github-integration";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { PBAC_ACTIONS, SUBJECT_ROLES } from "@lcsp/contracts/pbac";
import { SCAN_EVENT_TYPES } from "@lcsp/contracts/scan";

import {
  fromPrismaAssessmentStatus,
  fromPrismaRepositoryScanJobStatus,
  toPrismaRepositoryScanJobStatus,
  toPrismaRepositoryScanTriggerSource,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import type { RerunScanResponseDto } from "../../contracts/scan/rerun-scan.contract.js";
import { RerunScanCommand } from "./rerun-scan.command.js";

/**
 * Creates manual scan reruns for manager-owned assessments while preserving snapshot, tenant, lifecycle, and idempotency guarantees.
 */
@CommandHandler(RerunScanCommand)
export class RerunScanHandler implements ICommandHandler<RerunScanCommand> {
  /**
   * Creates the rerun handler with scan persistence, audit, and transactional outbox dependencies.
   *
   * @param prisma - Prisma service used for idempotency, snapshot/assessment validation, and scan-job persistence.
   * @param auditWriter - Audit writer used to record successful rerun requests.
   * @param outbox - Transactional outbox used to dispatch the new scan job.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
    private readonly outbox: OutboxRepository,
  ) {}

  /**
   * Deduplicates, authorizes, validates, and queues a new manual scan job for an existing pinned snapshot.
   *
   * @param command - Assessment/snapshot identity, idempotency key, PBAC context, correlation ID, and optional reason.
   * @returns Rerun scan job metadata, including the prior job identifier when available.
   * @throws When the idempotency key conflicts, snapshot/assessment is unavailable, manager ownership fails, or assessment state is ineligible.
   */
  async execute(command: RerunScanCommand): Promise<RerunScanResponseDto> {
    const pbac = command.pbacContext;
    // Basic org validation and PBAC was handled by the guard, but we still ensure assessment belongs to org

    if (!command.idempotencyKey) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.scanIdempotencyKeyRequired,
        command.correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }

    const existing = await this.prisma.repositoryScanJob.findUnique({
      where: { idempotencyKey: command.idempotencyKey },
    });

    if (existing) {
      if (
        existing.assessmentId !== command.assessmentId ||
        existing.snapshotId !== command.snapshotId ||
        existing.organizationId !== pbac.organizationId
      ) {
        throw problemException(
          GITHUB_INTEGRATION_ERROR_CODES.scanIdempotencyConflict,
          command.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      return this.toDto(
        existing.id,
        fromPrismaRepositoryScanJobStatus(existing.status),
        undefined,
        command.correlationId,
      );
    }

    const snapshot = await this.prisma.repositorySnapshot.findUnique({
      where: { id: command.snapshotId },
      select: {
        id: true,
        assessmentId: true,
        organizationId: true,
        commitSha: true,
      },
    });

    if (
      !snapshot ||
      snapshot.organizationId !== pbac.organizationId ||
      snapshot.assessmentId !== command.assessmentId
    ) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.snapshotNotFound,
        command.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const assessment = await this.prisma.assessment.findUnique({
      where: { id: command.assessmentId },
      select: { id: true, organizationId: true, ownerId: true, status: true },
    });

    if (!assessment || assessment.organizationId !== pbac.organizationId) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.snapshotNotFound,
        command.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const isManagerOwner =
      pbac.subjectRole === SUBJECT_ROLES.manager &&
      pbac.userId === assessment.ownerId;

    if (!isManagerOwner) {
      throw problemException(
        AUTH_ERROR_CODES.pbacDenied,
        command.correlationId,
        {
          status: HttpStatus.FORBIDDEN,
        },
      );
    }

    const assessmentStatus = fromPrismaAssessmentStatus(assessment.status);
    if (
      assessmentStatus !== ASSESSMENT_STATUS_CODES.wizardSubmitted &&
      assessmentStatus !== ASSESSMENT_STATUS_CODES.readyForReview
    ) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.assessmentStateInvalid,
        command.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }

    // Find prior job to keep track
    const priorJob = await this.prisma.repositoryScanJob.findFirst({
      where: { assessmentId: command.assessmentId },
      orderBy: { createdAt: "desc" },
    });

    const newScanJobId = randomUUID();
    const triggerSource = REPOSITORY_SCAN_TRIGGER_SOURCES.manual;
    const status = REPOSITORY_SCAN_JOB_STATUSES.queued;

    const event = buildOutboxMessageInput({
      aggregateType: OUTBOX_AGGREGATE_TYPES.repositoryScanJob,
      aggregateId: newScanJobId,
      eventType: GITHUB_INTEGRATION_EVENT_TYPES.scanTriggered,
      organizationId: pbac.organizationId,
      assessmentId: command.assessmentId,
      correlationId: command.correlationId,
      causationId: command.correlationId,
      actor: { id: pbac.userId, type: AUDIT_ACTOR_TYPES.user },
      result: SCAN_EVENT_TYPES.scanRerunTriggeredAudit,
      redactionStatus: AUDIT_REDACTION_STATUSES.none,
      authorizationAction: PBAC_ACTIONS.scanTrigger,
      idempotencyKey: command.idempotencyKey,
      payload: {
        scanJobId: newScanJobId,
        assessmentId: command.assessmentId,
        snapshotId: command.snapshotId,
        commitSha: snapshot.commitSha,
        organizationId: pbac.organizationId,
        triggerSource,
        idempotencyKey: command.idempotencyKey,
        correlationId: command.correlationId,
        replacesScanJobId: priorJob?.id,
      },
    });

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.repositoryScanJob.create({
          data: {
            id: newScanJobId,
            assessmentId: command.assessmentId,
            snapshotId: command.snapshotId,
            organizationId: pbac.organizationId,
            idempotencyKey: command.idempotencyKey,
            triggerSource: toPrismaRepositoryScanTriggerSource(triggerSource),
            status: toPrismaRepositoryScanJobStatus(status),
            correlationId: command.correlationId,
          },
        });
        await this.outbox.enqueue(event, tx);
      });
    } catch (e) {
      // Possible idempotency race
      const raced = await this.prisma.repositoryScanJob.findUnique({
        where: { idempotencyKey: command.idempotencyKey },
      });
      if (raced) {
        return this.toDto(
          raced.id,
          fromPrismaRepositoryScanJobStatus(raced.status),
          priorJob?.id,
          command.correlationId,
        );
      }
      throw e;
    }

    await this.auditWriter.write({
      eventType: SCAN_EVENT_TYPES.scanRerunTriggeredAudit,
      actorId: pbac.userId,
      organizationId: pbac.organizationId,
      assessmentId: command.assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.repositoryScanJob,
      resourceId: newScanJobId,
      correlationId: command.correlationId,
      causationId: command.correlationId,
      decision: AUDIT_DECISIONS.allow,
      result: SCAN_EVENT_TYPES.scanRerunTriggeredAudit,
      redactionStatus: AUDIT_REDACTION_STATUSES.none,
      payload: {
        newScanJobId,
        priorScanJobId: priorJob?.id,
        assessmentId: command.assessmentId,
        correlationId: command.correlationId,
        reason: command.reason,
      },
    });

    return this.toDto(
      newScanJobId,
      status,
      priorJob?.id,
      command.correlationId,
    );
  }

  /**
   * Maps scan-job identity/status into the external trigger response contract.
   *
   * @param scanJobId - Current scan-job identifier.
   * @param status - Normalized scan-job lifecycle status.
   * @param replacesScanJobId - Prior scan-job identifier when this rerun supersedes one.
   * @param correlationId - Correlation identifier to include in the response.
   * @returns Rerun scan response DTO.
   */
  private toDto(
    scanJobId: string,
    status: string,
    replacesScanJobId: string | undefined,
    correlationId: string,
  ): RerunScanResponseDto {
    return {
      scan_job_id: scanJobId,
      status,
      replaces_scan_job_id: replacesScanJobId,
      correlationId: correlationId,
    };
  }
}
