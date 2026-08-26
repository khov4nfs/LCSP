import {
  REPOSITORY_SCAN_JOB_STATUSES,
  type RepositoryScanJobStatus,
} from "@lcsp/contracts/github-integration";
import { SCAN_ERROR_CODES, SCAN_JOB_GUIDANCE } from "@lcsp/contracts/scan";
import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";

import {
  fromPrismaRepositoryScanJobStatus,
  fromPrismaRepositoryScanTriggerSource,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import type { ScanJobStatusDto } from "../../contracts/scan/scan-job-status.contract.js";
import { GetScanJobQuery } from "./get-scan-job.query.js";

/**
 * Resolves one caller-visible scan job and projects business guidance for its current lifecycle state.
 */
@QueryHandler(GetScanJobQuery)
export class GetScanJobHandler implements IQueryHandler<GetScanJobQuery> {
  /**
   * Creates the scan-job query handler with repository scan persistence access.
   *
   * @param prisma - Prisma service used to retrieve the organization/assessment-scoped scan job.
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Loads the scan job and returns normalized status, blocked reason, and next-action guidance.
   *
   * @param query - Scan-job identity, tenant/role/scope, and correlation context.
   * @returns Normalized scan-job status DTO.
   * @throws A job-not-found problem when the job is missing from the assessment scope.
   */
  async execute(query: GetScanJobQuery): Promise<ScanJobStatusDto> {
    const job = await this.prisma.repositoryScanJob.findFirst({
      where: {
        id: query.scanJobId,
        assessmentId: query.assessmentId,
      },
      select: {
        id: true,
        assessmentId: true,
        status: true,
        triggerSource: true,
        attemptCount: true,
        blockedReason: true,
        createdAt: true,
        updatedAt: true,
        correlationId: true,
      },
    });

    if (!job) {
      this.notFound(query.correlationId);
    }

    const status = fromPrismaRepositoryScanJobStatus(job.status);
    return {
      scan_job_id: job.id,
      assessment_id: job.assessmentId,
      status,
      trigger_source: fromPrismaRepositoryScanTriggerSource(job.triggerSource),
      attempt_count: job.attemptCount,
      blocked_reason: blockedReasonFor(status, job.blockedReason),
      next_action: nextActionFor(status),
      created_at: job.createdAt.toISOString(),
      updated_at: job.updatedAt.toISOString(),
      correlationId: job.correlationId,
    };
  }

  /**
   * Throws the scope-safe scan-job-not-found problem.
   *
   * @param correlationId - Correlation identifier attached to the problem response.
   * @throws Always throws the scan-job-not-found problem.
   */
  private notFound(correlationId: string): never {
    throw problemException(SCAN_ERROR_CODES.jobNotFound, correlationId, {
      status: HttpStatus.NOT_FOUND,
    });
  }
}

/**
 * Maps scan lifecycle state to a stable business next-action message.
 *
 * @param status - Normalized repository scan job status.
 * @returns Guidance string for non-terminal states, or null when completed.
 */
function nextActionFor(status: RepositoryScanJobStatus): string | null {
  switch (status) {
    case REPOSITORY_SCAN_JOB_STATUSES.queued:
      return SCAN_JOB_GUIDANCE.queuedNextAction;
    case REPOSITORY_SCAN_JOB_STATUSES.running:
      return SCAN_JOB_GUIDANCE.runningNextAction;
    case REPOSITORY_SCAN_JOB_STATUSES.failed:
      return SCAN_JOB_GUIDANCE.failedNextAction;
    case REPOSITORY_SCAN_JOB_STATUSES.blocked:
      return SCAN_JOB_GUIDANCE.blockedNextAction;
    case REPOSITORY_SCAN_JOB_STATUSES.pendingMapping:
      return SCAN_JOB_GUIDANCE.pendingMappingNextAction;
    case REPOSITORY_SCAN_JOB_STATUSES.blockedMapping:
      return SCAN_JOB_GUIDANCE.blockedMappingNextAction;
    case REPOSITORY_SCAN_JOB_STATUSES.waitingForContext:
      return SCAN_JOB_GUIDANCE.waitingForContextNextAction;
    case REPOSITORY_SCAN_JOB_STATUSES.readyToSnapshot:
      return SCAN_JOB_GUIDANCE.readyToSnapshotNextAction;
    case REPOSITORY_SCAN_JOB_STATUSES.completed:
      return null;
  }
}

/**
 * Maps scan lifecycle state to a business-safe blocked/waiting reason, preserving persisted reasons for other states.
 *
 * @param status - Normalized repository scan job status.
 * @param blockedReason - Persisted blocked reason from the scan job, when available.
 * @returns Contract guidance reason or the persisted reason for statuses without a fixed message.
 */
function blockedReasonFor(
  status: RepositoryScanJobStatus,
  blockedReason: string | null | undefined,
): string | null {
  switch (status) {
    case REPOSITORY_SCAN_JOB_STATUSES.blocked:
      return SCAN_JOB_GUIDANCE.blockedReason;
    case REPOSITORY_SCAN_JOB_STATUSES.pendingMapping:
      return SCAN_JOB_GUIDANCE.pendingMappingReason;
    case REPOSITORY_SCAN_JOB_STATUSES.blockedMapping:
      return SCAN_JOB_GUIDANCE.blockedMappingReason;
    case REPOSITORY_SCAN_JOB_STATUSES.waitingForContext:
      return SCAN_JOB_GUIDANCE.waitingForContextReason;
    case REPOSITORY_SCAN_JOB_STATUSES.readyToSnapshot:
      return SCAN_JOB_GUIDANCE.readyToSnapshotReason;
    default:
      return blockedReason ?? null;
  }
}
