import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Inject,
  NotFoundException,
} from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { ASSESSMENT_STATUS_CODES } from "@lcsp/contracts/assessment";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import { AUTH_ERROR_CODES, AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  GITHUB_INTEGRATION_ERROR_CODES,
  GITHUB_INTEGRATION_EVENT_TYPES,
  REPOSITORY_SCAN_JOB_STATUSES,
  REPOSITORY_SCAN_TRIGGER_SOURCES,
  type RepositoryScanJobStatus,
} from "@lcsp/contracts/github-integration";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";

import { fromPrismaAssessmentStatus } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemResult } from "../../../../../platform/problems/problem-factory.js";
import { RepositoryScanJob } from "../../../domain/entities/repository-scan-job.entity.js";
import type { TriggerScanDto } from "../../contracts/github-integration/trigger-scan.contract.js";
import {
  REPOSITORY_SCAN_JOB_REPOSITORY,
  type RepositoryScanJobRepository,
} from "../../ports/persistence/repository-scan-job.repository.js";
import { TriggerScanCommand } from "./trigger-scan.command.js";

/**
 * Creates idempotent repository scan jobs after validating snapshot, assessment, RBAC ownership, lifecycle, and mapping readiness.
 */
@CommandHandler(TriggerScanCommand)
export class TriggerScanHandler implements ICommandHandler<TriggerScanCommand> {
  /**
   * Creates the scan trigger handler with job persistence, assessment state, and audit dependencies.
   *
   * @param scanJobRepository - Repository used for idempotent scan-job lookup and transactional creation/outbox persistence.
   * @param prisma - Prisma service used to validate snapshot and assessment state.
   * @param auditWriter - Audit writer used to record accepted, duplicate, blocked, and rejected triggers.
   */
  constructor(
    @Inject(REPOSITORY_SCAN_JOB_REPOSITORY)
    private readonly scanJobRepository: RepositoryScanJobRepository,
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  /**
   * Validates the trigger request, deduplicates by idempotency key, handles mapping readiness, and persists the scan-trigger outbox event.
   *
   * @param command - Assessment/snapshot, trigger provenance, actor/RBAC, idempotency, and correlation context.
   * @returns Scan-job metadata indicating whether a new job was created.
   * @throws When required idempotency/snapshot/assessment/RBAC/lifecycle constraints are not satisfied.
   */
  async execute(command: TriggerScanCommand): Promise<TriggerScanDto> {
    const snapshotId = clean(command.snapshotId);
    const idempotencyKey = clean(command.idempotencyKey);
    if (!idempotencyKey) {
      await this.auditRejected(
        command,
        GITHUB_INTEGRATION_ERROR_CODES.scanIdempotencyKeyRequired,
      );
      throw new BadRequestException(
        this.errorBody(
          command,
          GITHUB_INTEGRATION_ERROR_CODES.scanIdempotencyKeyRequired,
        ),
      );
    }

    const snapshot = snapshotId
      ? await this.prisma.repositorySnapshot.findUnique({
          where: { id: snapshotId },
          select: {
            id: true,
            assessmentId: true,
            repositoryId: true,
            repositoryFullName: true,
            commitSha: true,
          },
        })
      : null;
    const isTrusted =
      command.triggerSource === REPOSITORY_SCAN_TRIGGER_SOURCES.trusted;
    if (!snapshot || snapshot.assessmentId !== command.assessmentId) {
      await this.auditRejected(
        command,
        GITHUB_INTEGRATION_ERROR_CODES.snapshotNotFound,
      );
      throw new NotFoundException(
        this.errorBody(
          command,
          GITHUB_INTEGRATION_ERROR_CODES.snapshotNotFound,
        ),
      );
    }

    const assessment = await this.prisma.assessment.findUnique({
      where: { id: command.assessmentId },
      select: {
        id: true,
        ownerId: true,
        status: true,
      },
    });
    if (!assessment) {
      await this.auditRejected(
        command,
        GITHUB_INTEGRATION_ERROR_CODES.snapshotNotFound,
      );
      throw new NotFoundException(
        this.errorBody(
          command,
          GITHUB_INTEGRATION_ERROR_CODES.snapshotNotFound,
        ),
      );
    }

    const isCustomerOwner =
      command.subjectRole === AUTH_USER_ROLES.customer &&
      command.actorId === assessment.ownerId;
    if (!isTrusted && !isCustomerOwner) {
      await this.auditRejected(command, AUTH_ERROR_CODES.rbacDenied);
      throw new ForbiddenException(
        this.errorBody(command, AUTH_ERROR_CODES.rbacDenied),
      );
    }

    const existing =
      await this.scanJobRepository.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      return this.resolveExisting(command, existing);
    }

    if (
      fromPrismaAssessmentStatus(assessment.status) !==
      ASSESSMENT_STATUS_CODES.wizardSubmitted
    ) {
      await this.auditRejected(
        command,
        GITHUB_INTEGRATION_ERROR_CODES.assessmentStateInvalid,
      );
      throw new ConflictException(
        this.errorBody(
          command,
          GITHUB_INTEGRATION_ERROR_CODES.assessmentStateInvalid,
        ),
      );
    }

    const mappingStatus = resolveMappingStatus(snapshot);
    if (mappingStatus !== REPOSITORY_SCAN_JOB_STATUSES.readyToSnapshot) {
      const job = RepositoryScanJob.createWithStatus({
        assessmentId: command.assessmentId,
        snapshotId: snapshot.id,
        idempotencyKey,
        triggerSource: command.triggerSource,
        correlationId: command.correlationId,
        status: mappingStatus,
        blockedReason: GITHUB_INTEGRATION_ERROR_CODES.scanBlockedMapping,
      });
      await this.scanJobRepository.save(job);
      await this.auditWriter.write({
        eventType: GITHUB_INTEGRATION_EVENT_TYPES.scanTriggerRejectedAudit,
        actorId: command.actorId,
        assessmentId: job.assessmentId,
        resourceType: AUDIT_RESOURCE_TYPES.repositoryScanJob,
        resourceId: job.id,
        correlationId: command.correlationId,
        reasonCode: GITHUB_INTEGRATION_ERROR_CODES.scanBlockedMapping,
        decision: AUDIT_DECISIONS.deny,
        payload: {
          scanJobId: job.id,
          assessmentId: job.assessmentId,
          snapshotId: job.snapshotId,
          triggerSource: job.triggerSource,
          status: job.status,
          reasonCode: GITHUB_INTEGRATION_ERROR_CODES.scanBlockedMapping,
          correlationId: command.correlationId,
        },
      });
      return this.toDto(job, true, command.correlationId);
    }

    const job = RepositoryScanJob.create({
      assessmentId: command.assessmentId,
      snapshotId: snapshot.id,
      idempotencyKey,
      triggerSource: command.triggerSource,
      correlationId: command.correlationId,
    });
    const event = buildOutboxMessageInput({
      aggregateType: OUTBOX_AGGREGATE_TYPES.repositoryScanJob,
      aggregateId: job.id,
      eventType: GITHUB_INTEGRATION_EVENT_TYPES.scanTriggered,
      assessmentId: job.assessmentId,
      correlationId: job.correlationId,
      causationId: command.correlationId,
      actor: {
        id: command.actorId,
        type: isTrusted ? AUDIT_ACTOR_TYPES.service : AUDIT_ACTOR_TYPES.user,
      },
      result: GITHUB_INTEGRATION_EVENT_TYPES.scanJobTriggeredAudit,
      redactionStatus: AUDIT_REDACTION_STATUSES.none,
      idempotencyKey: job.idempotencyKey,
      payload: {
        scanJobId: job.id,
        assessmentId: job.assessmentId,
        snapshotId: job.snapshotId,
        commitSha: snapshot.commitSha,
        triggerSource: job.triggerSource,
        idempotencyKey: job.idempotencyKey,
        correlationId: job.correlationId,
      },
    });

    try {
      await this.scanJobRepository.saveWithTriggeredEvent(job, event);
    } catch (error) {
      const raced =
        await this.scanJobRepository.findByIdempotencyKey(idempotencyKey);
      if (raced) {
        return this.resolveExisting(command, raced);
      }
      throw error;
    }

    await this.auditWriter.write({
      eventType: GITHUB_INTEGRATION_EVENT_TYPES.scanJobTriggeredAudit,
      actorId: command.actorId,
      assessmentId: job.assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.repositoryScanJob,
      resourceId: job.id,
      correlationId: command.correlationId,
      causationId: command.correlationId,
      decision: AUDIT_DECISIONS.allow,
      result: GITHUB_INTEGRATION_EVENT_TYPES.scanJobTriggeredAudit,
      redactionStatus: AUDIT_REDACTION_STATUSES.none,
      payload: event.payload,
    });

    return this.toDto(job, true, command.correlationId);
  }

  /**
   * Validates an idempotent existing job against the incoming trigger and records a duplicate audit event when compatible.
   *
   * @param command - Incoming scan-trigger command.
   * @param existing - Existing job found by the idempotency key.
   * @returns Existing scan job projected as a non-new response.
   * @throws When the same idempotency key is reused for different scan inputs.
   */
  private async resolveExisting(
    command: TriggerScanCommand,
    existing: RepositoryScanJob,
  ): Promise<TriggerScanDto> {
    if (
      existing.assessmentId !== command.assessmentId ||
      existing.snapshotId !== clean(command.snapshotId) ||
      existing.triggerSource !== command.triggerSource
    ) {
      await this.auditRejected(
        command,
        GITHUB_INTEGRATION_ERROR_CODES.scanIdempotencyConflict,
      );
      throw new ConflictException(
        this.errorBody(
          command,
          GITHUB_INTEGRATION_ERROR_CODES.scanIdempotencyConflict,
        ),
      );
    }

    await this.auditWriter.write({
      eventType: GITHUB_INTEGRATION_EVENT_TYPES.scanTriggerDuplicateAudit,
      actorId: command.actorId,
      resourceType: AUDIT_RESOURCE_TYPES.repositoryScanJob,
      resourceId: existing.id,
      correlationId: command.correlationId,
      decision: AUDIT_DECISIONS.allow,
      payload: {
        scanJobId: existing.id,
        assessmentId: existing.assessmentId,
        snapshotId: existing.snapshotId,
        idempotencyKey: existing.idempotencyKey,
        correlationId: command.correlationId,
      },
    });
    return this.toDto(existing, false, command.correlationId);
  }

  /**
   * Maps a scan-job aggregate to the external trigger response contract.
   *
   * @param job - Scan-job aggregate to serialize.
   * @param isNew - Whether this request created the job rather than returning an idempotent existing one.
   * @param correlationId - Correlation identifier to include in the response.
   * @returns Trigger scan DTO.
   */
  private toDto(
    job: RepositoryScanJob,
    isNew: boolean,
    correlationId: string,
  ): TriggerScanDto {
    return {
      scan_job_id: job.id,
      status: job.status,
      is_new: isNew,
      correlationId: correlationId,
    };
  }

  /**
   * Records a rejected scan trigger before the corresponding external exception is raised.
   *
   * @param command - Incoming trigger context.
   * @param reasonCode - Stable rejection reason.
   * @returns A promise that resolves after the denial audit event is written.
   */
  private async auditRejected(
    command: TriggerScanCommand,
    reasonCode: string,
  ): Promise<void> {
    await this.auditWriter.write({
      eventType: GITHUB_INTEGRATION_EVENT_TYPES.scanTriggerRejectedAudit,
      actorId: command.actorId,
      resourceType: AUDIT_RESOURCE_TYPES.repositorySnapshot,
      resourceId: clean(command.snapshotId) ?? command.assessmentId,
      correlationId: command.correlationId,
      reasonCode,
      decision: AUDIT_DECISIONS.deny,
      payload: {
        assessmentId: command.assessmentId,
        snapshotId: clean(command.snapshotId),
        triggerSource: command.triggerSource,
        reasonCode,
        correlationId: command.correlationId,
      },
    });
  }

  /**
   * Builds the standard problem payload used by scan-trigger HTTP exceptions.
   *
   * @param command - Trigger command supplying the correlation identifier.
   * @param errorCode - Stable GitHub integration or RBAC error code.
   * @returns Standard bad-request-shaped problem result.
   */
  private errorBody(command: TriggerScanCommand, errorCode: string) {
    return problemResult(errorCode, command.correlationId, {
      status: HttpStatus.BAD_REQUEST,
    });
  }
}

/**
 * Normalizes a non-empty string without coercing other runtime types.
 *
 * @param value - Unknown value to normalize.
 * @returns Trimmed string, or null when empty/non-string.
 */
function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Derives the pre-scan mapping state from snapshot repository identity and commit completeness.
 *
 * @param snapshot - Minimal snapshot fields required to assess mapping readiness.
 * @returns Scan-job status describing whether mapping is pending, blocked, waiting for commit context, or ready to snapshot.
 */
function resolveMappingStatus(snapshot: {
  repositoryId: string;
  repositoryFullName: string;
  commitSha: string;
}): RepositoryScanJobStatus {
  if (!clean(snapshot.repositoryId) || !clean(snapshot.repositoryFullName)) {
    return REPOSITORY_SCAN_JOB_STATUSES.pendingMapping;
  }
  if (!clean(snapshot.commitSha)) {
    return REPOSITORY_SCAN_JOB_STATUSES.waitingForContext;
  }
  if (!/^[0-9a-f]{40}$/i.test(snapshot.commitSha)) {
    return REPOSITORY_SCAN_JOB_STATUSES.blockedMapping;
  }
  return REPOSITORY_SCAN_JOB_STATUSES.readyToSnapshot;
}
