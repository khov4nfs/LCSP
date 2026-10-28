import { HttpStatus, Inject, Logger, Optional } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";

import {
  GITHUB_INTEGRATION_ERROR_CODES,
  GITHUB_CREDENTIAL_ERROR_CODES,
  GITHUB_CREDENTIAL_OPERATIONS,
  GITHUB_ARCHIVE_REDIRECT_VALIDATION_STATUSES,
  GITHUB_ARCHIVE_TRANSPORT_ERROR_CODES,
  REPOSITORY_CONNECTION_STATUSES,
  REPOSITORY_SCAN_JOB_STATUSES,
  CREDENTIAL_PROVIDERS,
} from "@lcsp/contracts/github-integration";
import { RepositoryAuthenticationMode } from "@prisma/client";

import {
  fromPrismaRepositoryConnectionStatus,
  fromPrismaRepositoryScanJobStatus,
  toPrismaRepositoryScanJobStatus,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { StreamSnapshotArchiveQuery } from "./stream-snapshot-archive.query.js";
import { SnapshotArchiveCache } from "../../../infrastructure/github/snapshot-archive-cache.js";
import {
  CREDENTIAL_AUTHORIZATION_RESOLVER,
  type CredentialAuthorizationResolverPort,
} from "../../../application/ports/security/credential-authorization-resolver.port.js";
import {
  GITHUB_ARCHIVE_TRANSPORT,
  REPOSITORY_ARCHIVE_TRANSPORT_REGISTRY,
  type GitHubArchiveTransportPort,
  type RepositoryArchiveTransportRegistry,
} from "../../../application/ports/github-archive-transport.port.js";
import { GitHubArchiveTransportError } from "../../../infrastructure/github/github-secure-archive-http.transport.js";
import { CredentialResolutionError } from "../../../infrastructure/persistence/prisma-credential-authorization.resolver.js";
import type { CredentialLease } from "../../../application/security/credential-lease.js";
import { RuntimeHydrationTicketLifecycle } from "../../services/runtime-hydration-ticket-lifecycle.service.js";

export type SnapshotArchiveStreamResult = {
  snapshotId: string;
  commitSha: string;
  repositoryFullName: string;
  contentType: string;
  resolvedUrl: string;
  stream: NodeJS.ReadableStream;
  hydrationDeliveryTicketId?: string;
};

/**
 * Claims an eligible scan job and streams the exact pinned repository archive associated with its snapshot.
 */
@QueryHandler(StreamSnapshotArchiveQuery)
export class StreamSnapshotArchiveHandler implements IQueryHandler<StreamSnapshotArchiveQuery> {
  private readonly logger = new Logger(StreamSnapshotArchiveHandler.name);

  /**
   * Creates the archive-stream handler with persistence, credential-leased archive transports, and ephemeral pinned-source caching.
   *
   * @param prisma - Prisma service used to validate scan/snapshot/connection state and atomically claim queued jobs.
   * @param snapshotArchiveCache - Temporary TTL cache used to reuse the exact pinned archive across reruns.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshotArchiveCache: SnapshotArchiveCache,
    @Inject(CREDENTIAL_AUTHORIZATION_RESOLVER)
    private readonly credentialResolver: CredentialAuthorizationResolverPort,
    @Inject(GITHUB_ARCHIVE_TRANSPORT)
    private readonly githubArchiveTransport: GitHubArchiveTransportPort,
    private readonly hydrationLifecycle: RuntimeHydrationTicketLifecycle,
    @Optional()
    @Inject(REPOSITORY_ARCHIVE_TRANSPORT_REGISTRY)
    private readonly archiveTransportRegistry?: RepositoryArchiveTransportRegistry,
  ) {}

  /**
   * Business purpose: Stream the repository archive for the exact immutable snapshot commit used by the requesting scan.
   * Completed scans remain read-only provenance for downstream rule investigation and are never re-claimed.
   *
   * Business rules:
   * - The scan job must reference the requested snapshot and be in a state allowed for this archive flow.
   * - Repository identity and active connection identity must match the snapshot; retired GitHub App authentication is unsupported.
   * - Hydration tickets are claimed through their lifecycle and only a verified redirect result may be streamed.
   * - Cache reuse is keyed by snapshot and commit; it never substitutes a different repository revision.
   *
   * Execution flow:
   * 1. Validate scan-to-snapshot binding and eligible lifecycle state; atomically claim queued non-hydration scan work.
   * 2. Load the snapshot and active repository connection, verify repository/authentication shape, then check the pinned archive cache.
   * 3. For a cache miss, claim hydration delivery if needed, resolve a credential lease, and download the archive for the pinned commit.
   * 4. Require verified redirect validation, capture the stream for reruns when possible, and return immutable snapshot metadata with the stream.
   * 5. On retrieval failure, finalize any claimed hydration ticket, mark invalid credentials when identified, map the failure to a safe API problem, and dispose the lease.
   *
   * Failure cases:
   * - Scan/snapshot mismatch, unsupported job state, or a failed conditional claim raises `snapshotScanMismatch` (HTTP 409).
   * - Missing snapshots or unusable connections raise `snapshotNotFound` (HTTP 404); retired app credentials raise the unsupported-authentication conflict.
   * - Archive transport and credential-resolution failures raise `snapshotRetrievalFailed`, preserving HTTP 429 for upstream throttling and using HTTP 502 otherwise.
   *
   * Side effects:
   * - May transition a queued scan or hydration ticket, resolve and dispose a credential lease, make an outbound repository archive request, update invalid-credential state, capture a temporary cache copy, and write diagnostic logs.
   *
   * @param query - Snapshot identifier, scan-job identifier, and correlation context.
   * @returns Repository archive stream metadata for the exact pinned commit.
   */
  async execute(
    query: StreamSnapshotArchiveQuery,
  ): Promise<SnapshotArchiveStreamResult> {
    const scanJob = await this.prisma.repositoryScanJob.findUnique({
      where: { id: query.scanJobId },
      select: {
        id: true,
        assessmentId: true,
        snapshotId: true,
        status: true,
        triggerSource: true,
        idempotencyKey: true,
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
    const isHydration = this.hydrationLifecycle.isHydrationTicket(scanJob);
    const canReadPinnedArchive =
      scanJobStatus === REPOSITORY_SCAN_JOB_STATUSES.queued ||
      scanJobStatus === REPOSITORY_SCAN_JOB_STATUSES.running ||
      scanJobStatus === REPOSITORY_SCAN_JOB_STATUSES.completed ||
      (isHydration && scanJobStatus === REPOSITORY_SCAN_JOB_STATUSES.failed);
    if (!canReadPinnedArchive) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.snapshotScanMismatch,
        query.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }

    if (isHydration && scanJobStatus === REPOSITORY_SCAN_JOB_STATUSES.running) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.snapshotScanMismatch,
        query.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    const hydrationDeliveryTicketId =
      isHydration && scanJobStatus !== REPOSITORY_SCAN_JOB_STATUSES.completed
        ? scanJob.id
        : undefined;
    if (!isHydration && scanJobStatus === REPOSITORY_SCAN_JOB_STATUSES.queued) {
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
        connectionId: true,
        assessmentId: true,
        repositoryId: true,
        repositoryFullName: true,
        commitSha: true,
        status: true,
      },
    });

    if (!snapshot) {
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
        userId: true,
        installationId: true,
        status: true,
        authenticationMode: true,
        provider: true,
        providerCredentialId: true,
        repositoryId: true,
        repositoryFullName: true,
      },
    });

    if (
      !connection ||
      fromPrismaRepositoryConnectionStatus(connection.status) !==
        REPOSITORY_CONNECTION_STATUSES.active ||
      connection.repositoryId !== snapshot.repositoryId ||
      connection.repositoryFullName !== snapshot.repositoryFullName
    ) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.snapshotNotFound,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    if (
      connection.authenticationMode === RepositoryAuthenticationMode.GITHUB_APP
    ) {
      // Retired GitHub App connections are no longer resolvable; fail clearly.
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.repositoryAuthenticationModeUnsupported,
        query.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    if (!hasValidAuthenticationShape(connection)) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.snapshotNotFound,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const cacheHit = await this.readCachedArchive(
      snapshot.id,
      snapshot.commitSha,
      query.correlationId,
    );
    if (cacheHit) {
      if (hydrationDeliveryTicketId) {
        await this.hydrationLifecycle.claim(
          scanJob.id,
          scanJob.assessmentId,
          query.snapshotId,
          scanJobStatus,
        );
      }
      return {
        snapshotId: snapshot.id,
        commitSha: snapshot.commitSha,
        repositoryFullName: snapshot.repositoryFullName,
        contentType: cacheHit.contentType,
        resolvedUrl: cacheHit.resolvedUrl,
        stream: cacheHit.stream,
        ...(hydrationDeliveryTicketId ? { hydrationDeliveryTicketId } : {}),
      };
    }

    const leaseHolder: { lease: CredentialLease | null } = { lease: null };
    let hydrationClaimed = false;
    try {
      if (hydrationDeliveryTicketId) {
        await this.hydrationLifecycle.claim(
          scanJob.id,
          scanJob.assessmentId,
          query.snapshotId,
          scanJobStatus,
        );
        hydrationClaimed = true;
      }
      const archive = await (async () => {
        leaseHolder.lease = await this.credentialResolver.resolveForConnection(
          {
            actorId: null,
            userId: connection.userId,
            assessmentId: snapshot.assessmentId,
            operation: GITHUB_CREDENTIAL_OPERATIONS.retrieveArchive,
            correlationId: query.correlationId,
          },
          connection.id,
          snapshot.repositoryFullName,
        );
        const transport =
          this.archiveTransportRegistry?.get(connection.provider) ??
          this.githubArchiveTransport;
        const result = await transport.downloadArchive({
          credentialLease: leaseHolder.lease,
          repositoryId: snapshot.repositoryId,
          repositoryFullName: snapshot.repositoryFullName,
          commitSha: snapshot.commitSha,
        });
        if (
          result.redirectValidation !==
          GITHUB_ARCHIVE_REDIRECT_VALIDATION_STATUSES.verified
        ) {
          result.stream.destroy();
          throw new GitHubArchiveTransportError(
            GITHUB_ARCHIVE_TRANSPORT_ERROR_CODES.redirectValidationFailed,
          );
        }
        return {
          stream: result.stream,
          contentType: result.contentType,
          resolvedUrl: `https://${result.validatedHost}/`,
        };
      })();

      const stream = await this.captureArchiveForRerun(
        {
          snapshotId: snapshot.id,
          commitSha: snapshot.commitSha,
          contentType: archive.contentType,
          resolvedUrl: archive.resolvedUrl,
          source: archive.stream,
        },
        query.correlationId,
      );

      return {
        snapshotId: snapshot.id,
        commitSha: snapshot.commitSha,
        repositoryFullName: snapshot.repositoryFullName,
        contentType: archive.contentType,
        resolvedUrl: archive.resolvedUrl,
        stream,
        ...(hydrationDeliveryTicketId ? { hydrationDeliveryTicketId } : {}),
      };
    } catch (error: unknown) {
      if (hydrationDeliveryTicketId && hydrationClaimed) {
        try {
          await this.hydrationLifecycle.finalizeDelivery({
            ticketId: hydrationDeliveryTicketId,
            snapshotId: query.snapshotId,
            outcome: REPOSITORY_SCAN_JOB_STATUSES.failed,
          });
        } catch (finalizationError: unknown) {
          this.logger.error(
            "Runtime hydration failure could not be persisted",
            undefined,
            {
              scanJobId: hydrationDeliveryTicketId,
              reason:
                finalizationError instanceof Error
                  ? finalizationError.name
                  : "unknown",
            },
          );
        }
      }
      if (
        leaseHolder.lease &&
        error instanceof GitHubArchiveTransportError &&
        error.code === GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid
      ) {
        await this.credentialResolver.markInvalid(
          connection.id,
          leaseHolder.lease.credentialVersion,
          GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
        );
      }
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
        {
          status:
            archiveFailureStatus(error) === HttpStatus.TOO_MANY_REQUESTS
              ? HttpStatus.TOO_MANY_REQUESTS
              : HttpStatus.BAD_GATEWAY,
        },
      );
    } finally {
      leaseHolder.lease?.dispose();
    }
  }

  private async readCachedArchive(
    snapshotId: string,
    commitSha: string,
    correlationId: string,
  ) {
    try {
      const cacheHit = await this.snapshotArchiveCache.get({
        snapshotId,
        commitSha,
      });
      if (cacheHit) {
        this.logger.debug("Repository snapshot archive cache hit", {
          correlationId,
          snapshotId,
          commitSha,
        });
      }
      return cacheHit;
    } catch (error: unknown) {
      this.logger.warn(
        "Repository snapshot archive cache read failed; using GitHub",
        {
          correlationId,
          snapshotId,
          reason: cacheFailureReason(error),
        },
      );
      return null;
    }
  }

  private async captureArchiveForRerun(
    input: {
      snapshotId: string;
      commitSha: string;
      contentType: string;
      resolvedUrl: string;
      source: NodeJS.ReadableStream;
    },
    correlationId: string,
  ): Promise<NodeJS.ReadableStream> {
    try {
      const cached = await this.snapshotArchiveCache.capture(input);
      void cached.completion.catch((error: unknown) => {
        this.logger.warn("Repository snapshot archive cache write failed", {
          correlationId,
          snapshotId: input.snapshotId,
          reason: cacheFailureReason(error),
        });
      });
      return cached.stream;
    } catch (error: unknown) {
      this.logger.warn(
        "Repository snapshot archive cache unavailable; streaming directly",
        {
          correlationId,
          snapshotId: input.snapshotId,
          reason: cacheFailureReason(error),
        },
      );
      return input.source;
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
  if (error instanceof GitHubArchiveTransportError) return error.code;
  if (error instanceof CredentialResolutionError) return error.code;
  return "github_repository_archive_unknown_failure";
}

/**
 * Extracts the upstream GitHub HTTP status from a typed archive-client error.
 *
 * @param error - Unknown archive retrieval error.
 * @returns GitHub HTTP status, or null for non-client errors.
 */
function archiveFailureStatus(error: unknown): number | null {
  return error instanceof GitHubArchiveTransportError ? error.status : null;
}

function hasValidAuthenticationShape(connection: {
  authenticationMode: RepositoryAuthenticationMode;
  provider: string;
  installationId: string | null;
  providerCredentialId: string | null;
}): boolean {
  return (
    ((connection.authenticationMode ===
      RepositoryAuthenticationMode.GITHUB_CLI_CREDENTIAL &&
      connection.provider === CREDENTIAL_PROVIDERS.github) ||
      (connection.authenticationMode ===
        RepositoryAuthenticationMode.GITLAB_CLI_CREDENTIAL &&
        connection.provider === CREDENTIAL_PROVIDERS.gitlab) ||
      (connection.authenticationMode ===
        RepositoryAuthenticationMode.BITBUCKET_CLI_CREDENTIAL &&
        connection.provider === CREDENTIAL_PROVIDERS.bitbucket) ||
      (connection.authenticationMode ===
        RepositoryAuthenticationMode.AZURE_DEVOPS_CLI_CREDENTIAL &&
        connection.provider === CREDENTIAL_PROVIDERS.azureDevOps)) &&
    connection.installationId === null &&
    connection.providerCredentialId != null
  );
}

/** Returns a cache failure type without logging paths, raw source, or error payloads. */
function cacheFailureReason(error: unknown): string {
  return error instanceof Error ? error.name : "unknown_cache_failure";
}
