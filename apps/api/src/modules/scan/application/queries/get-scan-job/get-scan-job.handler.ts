import {
  REPOSITORY_SCAN_JOB_STATUSES,
  type RepositoryScanJobStatus,
} from "@lcsp/contracts/github-integration";
import { SUBJECT_ROLES } from "@lcsp/contracts/pbac";
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

@QueryHandler(GetScanJobQuery)
export class GetScanJobHandler implements IQueryHandler<GetScanJobQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: GetScanJobQuery): Promise<ScanJobStatusDto> {
    if (
      query.subjectRole === SUBJECT_ROLES.developer &&
      query.scope !== query.assessmentId
    ) {
      this.notFound(query.correlationId);
    }

    const job = await this.prisma.repositoryScanJob.findFirst({
      where: {
        id: query.scanJobId,
        assessmentId: query.assessmentId,
        organizationId: query.organizationId,
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

  private notFound(correlationId: string): never {
    throw problemException(SCAN_ERROR_CODES.jobNotFound, correlationId, {
      status: HttpStatus.NOT_FOUND,
    });
  }
}

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
