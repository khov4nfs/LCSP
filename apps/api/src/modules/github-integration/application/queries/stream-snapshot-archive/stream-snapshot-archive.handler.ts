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

/**
 * Claims an eligible scan job and streams the exact pinned GitHub repository archive associated with its snapshot.
 */
@QueryHandler(StreamSnapshotArchiveQuery)
export class StreamSnapshotArchiveHandler implements IQueryHandler<StreamSnapshotArchiveQuery> {
  private readonly logger = new Logger(StreamSnapshotArchiveHandler.name);

  /**
   * Creates the archive-stream handler with persistence and GitHub App access.
   *
   * @param prisma - Prisma service used to validate scan/snapshot/connection state and atomically claim queued jobs.
   * @param githubAppClient - GitHub App client used to download the repository archive for the pinned commit.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly githubAppClient: GitHubAppClient,
  ) {}

  /**
   * Validates scan-to-snapshot binding, claims queued work, resolves the active GitHub installation, and returns the archive stream.
   *
   * @param query - Snapshot identifier, scan-job identifier, and correlation context.
   * @returns Repository archive stream metadata for the exact pinned commit.
   * @throws When scan/snapshot/connection state is inconsistent or GitHub archive retrieval fails.
   */
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

/**
 * Converts a GitHub archive retrieval failure into a safe log reason without serializing the original error object.
 *
 * @param error - Unknown error raised by the GitHub archive client.
 * @returns GitHub client message when available, otherwise a stable unknown-failure label.
 */
function archiveFailureReason(error: unknown): string {
  if (error instanceof GitHubAppClientError) {
    return error.message;
  }

  return "github_repository_archive_unknown_failure";
}

/**
 * Extracts the upstream GitHub HTTP status from a typed archive-client error.
 *
 * @param error - Unknown archive retrieval error.
 * @returns GitHub HTTP status, or null for non-client errors.
 */
function archiveFailureStatus(error: unknown): number | null {
  return error instanceof GitHubAppClientError ? error.status : null;
}
