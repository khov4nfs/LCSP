import { HttpStatus, Logger } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";

import {
  GITHUB_INTEGRATION_ERROR_CODES,
  REPOSITORY_CONNECTION_STATUSES,
  REPOSITORY_SCAN_JOB_STATUSES,
} from "@lcsp/contracts/github-integration";

import {
  fromPrismaRepositoryConnectionStatus,
  fromPrismaRepositoryScanJobStatus,
  toPrismaRepositoryScanJobStatus,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { StreamSnapshotArchiveQuery } from "./stream-snapshot-archive.query.js";
import {
  GitHubAppClient,
  GitHubAppClientError,
} from "../../../infrastructure/github/github-app.client.js";

export type SnapshotArchiveStreamResult = {
  snapshotId: string;
  commitSha: string;
  repositoryFullName: string;
  contentType: string;
  resolvedUrl: string;
  stream: NodeJS.ReadableStream;
};

@QueryHandler(StreamSnapshotArchiveQuery)
export class StreamSnapshotArchiveHandler implements IQueryHandler<StreamSnapshotArchiveQuery> {
  private readonly logger = new Logger(StreamSnapshotArchiveHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly githubAppClient: GitHubAppClient,
  ) {}

  async execute(
    query: StreamSnapshotArchiveQuery,
  ): Promise<SnapshotArchiveStreamResult> {
    const scanJob = await this.prisma.repositoryScanJob.findUnique({
      where: { id: query.scanJobId },
      select: {
        id: true,
        snapshotId: true,
        organizationId: true,
        status: true,
      },
    });

    if (!scanJob || scanJob.snapshotId !== query.snapshotId) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.snapshotScanMismatch,
        query.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }

    const scanJobStatus = fromPrismaRepositoryScanJobStatus(scanJob.status);
    if (
      scanJobStatus !== REPOSITORY_SCAN_JOB_STATUSES.queued &&
      scanJobStatus !== REPOSITORY_SCAN_JOB_STATUSES.running
    ) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.snapshotScanMismatch,
        query.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }

    if (scanJobStatus === REPOSITORY_SCAN_JOB_STATUSES.queued) {
      const claim = await this.prisma.repositoryScanJob.updateMany({
        where: {
          id: scanJob.id,
          status: toPrismaRepositoryScanJobStatus(
            REPOSITORY_SCAN_JOB_STATUSES.queued,
          ),
        },
        data: {
          status: toPrismaRepositoryScanJobStatus(
            REPOSITORY_SCAN_JOB_STATUSES.running,
          ),
          attemptCount: { increment: 1 },
        },
      });
      if (claim.count !== 1) {
        throw problemException(
          GITHUB_INTEGRATION_ERROR_CODES.snapshotScanMismatch,
          query.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
    }

    const snapshot = await this.prisma.repositorySnapshot.findUnique({
      where: { id: query.snapshotId },
      select: {
        id: true,
        organizationId: true,
        connectionId: true,
        repositoryFullName: true,
        commitSha: true,
        status: true,
      },
    });

    if (!snapshot || snapshot.organizationId !== scanJob.organizationId) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.snapshotNotFound,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const connection = await this.prisma.repositoryConnection.findUnique({
      where: { id: snapshot.connectionId },
      select: {
        id: true,
        installationId: true,
        organizationId: true,
        status: true,
      },
    });

    if (
      !connection ||
      connection.organizationId !== snapshot.organizationId ||
      fromPrismaRepositoryConnectionStatus(connection.status) !==
        REPOSITORY_CONNECTION_STATUSES.active
    ) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.snapshotNotFound,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    try {
      const archive = await this.githubAppClient.downloadRepositoryArchive({
        installationId: connection.installationId,
        repositoryFullName: snapshot.repositoryFullName,
        commitSha: snapshot.commitSha,
      });

      return {
        snapshotId: snapshot.id,
        commitSha: snapshot.commitSha,
        repositoryFullName: snapshot.repositoryFullName,
        contentType: archive.contentType,
        resolvedUrl: archive.resolvedUrl,
        stream: archive.stream,
      };
    } catch (error: unknown) {
      this.logger.error(
        `GitHub snapshot archive retrieval failed: ${archiveFailureReason(error)}`,
        undefined,
        {
          correlationId: query.correlationId,
          snapshotId: snapshot.id,
          scanJobId: scanJob.id,
          repositoryFullName: snapshot.repositoryFullName,
          githubStatus: archiveFailureStatus(error),
        },
      );

      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.snapshotRetrievalFailed,
        query.correlationId,
        { status: HttpStatus.BAD_GATEWAY },
      );
    }
  }
}

function archiveFailureReason(error: unknown): string {
  if (error instanceof GitHubAppClientError) {
    return error.message;
  }

  return "github_repository_archive_unknown_failure";
}

function archiveFailureStatus(error: unknown): number | null {
  return error instanceof GitHubAppClientError ? error.status : null;
}
