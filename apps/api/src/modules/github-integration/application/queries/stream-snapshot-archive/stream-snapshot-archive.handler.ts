import { HttpException, HttpStatus, Inject, Logger } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";

import {
  ARCHIVE_ROOT_VERIFICATION_STATUSES,
  GITHUB_INTEGRATION_ERROR_CODES,
  GITHUB_CREDENTIAL_ERROR_CODES,
  GITHUB_CREDENTIAL_OPERATIONS,
  GITHUB_ARCHIVE_REDIRECT_VALIDATION_STATUSES,
  GITHUB_ARCHIVE_TRANSPORT_ERROR_CODES,
  REPOSITORY_CONNECTION_STATUSES,
  REPOSITORY_SCAN_JOB_STATUSES,
  CREDENTIAL_PROVIDERS,
  type ArchiveRootVerificationStatus,
  type GitHubCredentialErrorCode,
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
  REPOSITORY_PROVIDER_REGISTRY,
  type RepositoryProviderRegistry,
} from "../../../application/ports/github-repository-provider.port.js";
import {
  REPOSITORY_ARCHIVE_TRANSPORT_REGISTRY,
  type GitHubArchiveTransportPort,
  type PinnedRepositoryTreeManifest,
  type RepositoryArchiveTransportRegistry,
} from "../../../application/ports/github-archive-transport.port.js";
import { GitHubArchiveTransportError } from "../../../infrastructure/github/github-secure-archive-http.transport.js";
import { CredentialResolutionError } from "../../../infrastructure/persistence/prisma-credential-authorization.resolver.js";
import type { CredentialLease } from "../../../application/security/credential-lease.js";
import { RuntimeHydrationTicketLifecycle } from "../../services/runtime-hydration-ticket-lifecycle.service.js";
import { RepositoryProviderUnavailableError } from "../../../infrastructure/repository-provider.registry.js";
import {
  providerFailureCategory,
  providerFailureStatus,
} from "../../commands/github-cli-connect.support.js";

export type SnapshotArchiveStreamResult = {
  snapshotId: string;
  commitSha: string;
  repositoryFullName: string;
  contentType: string;
  archiveRoot?: string | null;
  treeManifest?: PinnedRepositoryTreeManifest;
  archiveRootStatus: ArchiveRootVerificationStatus;
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
   * @param prisma - Prisma service used to validate assessment, scan, snapshot, and connection ownership.
   * @param snapshotArchiveCache - Temporary TTL cache used to reuse the exact pinned archive across reruns.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshotArchiveCache: SnapshotArchiveCache,
    @Inject(CREDENTIAL_AUTHORIZATION_RESOLVER)
    private readonly credentialResolver: CredentialAuthorizationResolverPort,
    private readonly hydrationLifecycle: RuntimeHydrationTicketLifecycle,
    @Inject(REPOSITORY_ARCHIVE_TRANSPORT_REGISTRY)
    private readonly archiveTransportRegistry: RepositoryArchiveTransportRegistry,
    @Inject(REPOSITORY_PROVIDER_REGISTRY)
    private readonly providerRegistry: RepositoryProviderRegistry,
  ) {}

  /**
   * Business purpose: Stream the repository archive for the exact immutable snapshot commit used by the requesting scan.
   * Completed scans remain read-only provenance for downstream rule investigation and are never re-claimed.
   *
   * Business rules:
   * - The scan job and assessment must reference the requested snapshot; its owner, repository identity, provider, and active credential binding must all match.
   * - Current LCSP credential authorization is resolved before the cache is inspected; a cache entry never substitutes for authorization.
   * - Bitbucket and Azure source delivery requires an explicit provider-confirmed archive wrapper or rootless result; unknown archive semantics cannot reach an assessment.
   * - A request is authorized at the successful credential lease resolution. A revocation committed after that point may not cancel this delivery; requests authorized after revocation fail.
   * - Hydration tickets are claimed through their lifecycle and only a verified redirect result may be streamed.
   * - Cache reuse is keyed by snapshot and commit; it never substitutes a different repository revision.
   *
   * Execution flow:
   * 1. Validate scan/assessment/snapshot association, eligible state, current assessment owner, repository identity, and authentication shape.
   * 2. Require the exact provider to be registered, then resolve the current connection-bound lease; this database authorization read is the delivery linearization point.
   * 3. Atomically claim queued scan or hydration work, then inspect the cache or retrieve the exact pinned archive.
   * 4. Require verified redirect validation, capture the stream for reruns when possible, and return immutable snapshot metadata with the stream.
   * 5. On failure, finalize claimed hydration work, mark invalid credentials only on typed authoritative evidence, map safe failures, and dispose the lease on every path.
   *
   * Failure cases:
   * - Scan/assessment/snapshot mismatch, unsupported job state, or a failed conditional claim raises `snapshotScanMismatch` (HTTP 409).
   * - Missing snapshots or unusable connections raise `snapshotNotFound` (HTTP 404); retired app credentials raise the unsupported-authentication conflict.
   * - Revoked, expired, stale, mismatched, or disabled-provider requests fail before cache access or source delivery.
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
    if (scanJob.assessmentId !== snapshot.assessmentId) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.snapshotScanMismatch,
        query.correlationId,
        { status: HttpStatus.CONFLICT },
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

    const assessment = await this.prisma.assessment.findFirst({
      where: {
        id: snapshot.assessmentId,
        ownerId: connection.userId,
      },
      select: { id: true },
    });
    if (!assessment) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.snapshotNotFound,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    let transport: GitHubArchiveTransportPort;
    try {
      this.providerRegistry.get(connection.provider);
      transport = this.archiveTransportRegistry.get(connection.provider);
    } catch (error: unknown) {
      const category = providerFailureCategory(error);
      throw problemException(category, query.correlationId, {
        status: providerFailureStatus(category),
      });
    }

    const leaseHolder: { lease: CredentialLease | null } = { lease: null };
    let hydrationClaimed = false;
    try {
      const authorizedLease =
        await this.credentialResolver.resolveForConnection(
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
      leaseHolder.lease = authorizedLease;

      // A job is claimed only after persisted authorization has succeeded.
      if (
        !isHydration &&
        scanJobStatus === REPOSITORY_SCAN_JOB_STATUSES.queued
      ) {
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

      if (hydrationDeliveryTicketId) {
        await this.hydrationLifecycle.claim(
          scanJob.id,
          scanJob.assessmentId,
          query.snapshotId,
          scanJobStatus,
        );
        hydrationClaimed = true;
      }

      const cacheHit = await this.readCachedArchive(
        snapshot.id,
        snapshot.commitSha,
        query.correlationId,
      );
      if (cacheHit) {
        if (
          (cacheHit.archiveRoot === undefined &&
            (!cacheHit.treeManifest ||
              connection.provider !== CREDENTIAL_PROVIDERS.azureDevOps)) ||
          (cacheHit.treeManifest !== undefined &&
            (connection.provider !== CREDENTIAL_PROVIDERS.azureDevOps ||
              !isPinnedTreeManifestSafe(
                cacheHit.treeManifest,
                snapshot.commitSha,
              )))
        ) {
          cacheHit.stream.destroy();
          throw new GitHubArchiveTransportError(
            GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
          );
        }
        return {
          snapshotId: snapshot.id,
          commitSha: snapshot.commitSha,
          repositoryFullName: snapshot.repositoryFullName,
          contentType: cacheHit.contentType,
          ...(cacheHit.archiveRoot === undefined
            ? {}
            : { archiveRoot: cacheHit.archiveRoot }),
          ...(cacheHit.treeManifest === undefined
            ? {}
            : { treeManifest: cacheHit.treeManifest }),
          archiveRootStatus: archiveRootStatus(cacheHit.archiveRoot),
          resolvedUrl: cacheHit.resolvedUrl,
          stream: cacheHit.stream,
          ...(hydrationDeliveryTicketId ? { hydrationDeliveryTicketId } : {}),
        };
      }

      const result = await transport.downloadArchive({
        credentialLease: authorizedLease,
        repositoryId: snapshot.repositoryId,
        repositoryFullName: snapshot.repositoryFullName,
        commitSha: snapshot.commitSha,
      });
      if (
        (result.archiveRoot === undefined &&
          (!result.treeManifest ||
            connection.provider !== CREDENTIAL_PROVIDERS.azureDevOps)) ||
        (result.treeManifest !== undefined &&
          (connection.provider !== CREDENTIAL_PROVIDERS.azureDevOps ||
            !isPinnedTreeManifestSafe(result.treeManifest, snapshot.commitSha)))
      ) {
        result.stream.destroy();
        throw new GitHubArchiveTransportError(
          GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
        );
      }
      if (
        result.archiveRoot !== undefined &&
        !isArchiveRootMetadataSafe(result.archiveRoot)
      ) {
        result.stream.destroy();
        throw new GitHubArchiveTransportError(
          GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
        );
      }
      if (
        result.redirectValidation !==
        GITHUB_ARCHIVE_REDIRECT_VALIDATION_STATUSES.verified
      ) {
        result.stream.destroy();
        throw new GitHubArchiveTransportError(
          GITHUB_ARCHIVE_TRANSPORT_ERROR_CODES.redirectValidationFailed,
        );
      }
      const archive = {
        stream: result.stream,
        contentType: result.contentType,
        ...(result.archiveRoot === undefined
          ? {}
          : { archiveRoot: result.archiveRoot }),
        ...(result.treeManifest === undefined
          ? {}
          : { treeManifest: result.treeManifest }),
        resolvedUrl: `https://${result.validatedHost}/`,
      };

      const stream = await this.captureArchiveForRerun(
        {
          snapshotId: snapshot.id,
          commitSha: snapshot.commitSha,
          contentType: archive.contentType,
          ...(archive.archiveRoot === undefined
            ? {}
            : { archiveRoot: archive.archiveRoot }),
          ...(archive.treeManifest === undefined
            ? {}
            : { treeManifest: archive.treeManifest }),
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
        ...(archive.archiveRoot === undefined
          ? {}
          : { archiveRoot: archive.archiveRoot }),
        ...(archive.treeManifest === undefined
          ? {}
          : { treeManifest: archive.treeManifest }),
        archiveRootStatus: archiveRootStatus(archive.archiveRoot),
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
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `Repository snapshot archive retrieval failed: ${archiveFailureReason(error)}`,
        undefined,
        {
          correlationId: query.correlationId,
          snapshotId: snapshot.id,
          scanJobId: scanJob.id,
          repositoryFullName: snapshot.repositoryFullName,
          providerStatus: archiveFailureStatus(error),
        },
      );
      const providerCategory = resolveArchiveProviderCategory(error);
      if (providerCategory) {
        throw problemException(providerCategory, query.correlationId, {
          status: providerFailureStatus(providerCategory),
        });
      }
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.snapshotRetrievalFailed,
        query.correlationId,
        { status: HttpStatus.BAD_GATEWAY },
      );
    } finally {
      leaseHolder.lease?.dispose();
    }
  }

  /**
   * Business purpose: Reuse the archive bytes for the exact pinned snapshot when the temporary cache is healthy.
   * Business rules:
   * - The caller must complete current connection and credential authorization before cache lookup.
   * - Cache failure may reduce reuse but must never prevent retrieval of the authorized pinned commit.
   * Execution flow:
   * 1. Read by snapshot identifier and immutable commit SHA.
   * 2. Record a safe cache-hit diagnostic or convert cache failure to a miss.
   * Failure cases:
   * - Cache read errors are treated as misses; no provider or authorization error is concealed here.
   * Side effects:
   * - Reads temporary cache state and may write a diagnostic log.
   */
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
        "Repository snapshot archive cache read failed; using provider retrieval",
        {
          correlationId,
          snapshotId,
          reason: cacheFailureReason(error),
        },
      );
      return null;
    }
  }

  /**
   * Business purpose: Cache archive bytes and wrapper/format metadata for an authorized rerun without blocking delivery on cache availability.
   * Business rules:
   * - Cache key metadata stays bound to the immutable snapshot and commit.
   * - Cache write failure must leave the original authorized stream usable.
   * Execution flow:
   * 1. Tee the pinned stream into the temporary archive cache with its content type and exact root metadata.
   * 2. Observe asynchronous cache completion and log only a safe failure reason.
   * 3. Return the cache tee stream, or the original stream if cache setup fails.
   * Failure cases:
   * - Cache failures are logged without exposing source, credentials, or provider response data and do not replace the delivery result.
   * Side effects:
   * - May write ephemeral archive bytes/metadata and schedules cache eviction.
   */
  private async captureArchiveForRerun(
    input: {
      snapshotId: string;
      commitSha: string;
      contentType: string;
      archiveRoot?: string | null;
      treeManifest?: PinnedRepositoryTreeManifest;
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
 * Business purpose: Produce a safe diagnostic label for an archive failure without exposing provider payloads.
 * Business rules:
 * - Only known typed errors may contribute their stable category; raw messages and response content are never logged.
 * Execution flow:
 * 1. Return the category from a typed archive or credential error.
 * 2. Return a neutral label for every other value.
 * Failure cases:
 * - Typed credential/archive failures contribute a bounded category; unknown and non-error values map to the neutral archive failure label.
 * Side effects:
 * - Pure classification with no persistence or external action.
 */
function archiveFailureReason(error: unknown): string {
  if (error instanceof GitHubArchiveTransportError) return error.code;
  if (error instanceof CredentialResolutionError) return error.code;
  return "repository_archive_unknown_failure";
}

/**
 * Extracts the upstream HTTP status from a typed provider archive error.
 *
 * @param error - Unknown archive retrieval error.
 * @returns Provider HTTP status, or null for non-client errors.
 */
function archiveFailureStatus(error: unknown): number | null {
  return error instanceof GitHubArchiveTransportError ? error.status : null;
}

/**
 * Business purpose: Keep provider authentication failures actionable while preserving the existing generic archive failure envelope for transport-integrity errors.
 * Business rules:
 * - Credential/provider categories are accepted only from typed resolver or archive transport errors.
 * - Archive redirect/size failures are not misreported as credential failures.
 * Execution flow:
 * 1. Return a resolver code or typed archive credential code.
 * 2. Return null for the generic snapshot retrieval problem when no provider category applies.
 * Failure cases:
 * - Unrecognized errors and archive-integrity categories do not alter credential state or reveal provider response content.
 * Side effects:
 * - Pure error classification.
 */
function resolveArchiveProviderCategory(
  error: unknown,
): GitHubCredentialErrorCode | null {
  if (error instanceof CredentialResolutionError) return error.code;
  if (error instanceof RepositoryProviderUnavailableError) {
    return error.category;
  }
  if (
    error instanceof GitHubArchiveTransportError &&
    !Object.values(GITHUB_ARCHIVE_TRANSPORT_ERROR_CODES).includes(
      error.code as (typeof GITHUB_ARCHIVE_TRANSPORT_ERROR_CODES)[keyof typeof GITHUB_ARCHIVE_TRANSPORT_ERROR_CODES],
    )
  ) {
    return error.code as GitHubCredentialErrorCode;
  }
  return null;
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

/**
 * Business purpose: Ensure an archive wrapper name is a trusted single directory component before caching or returning it to hydration.
 * Business rules:
 * - Null preserves the archive's complete path tree.
 * - Supplied names cannot contain traversal, separators, drive syntax, or controls.
 * Execution flow:
 * 1. Accept null.
 * 2. Require a bounded non-empty component.
 * 3. Reject path ambiguity.
 * Failure cases:
 * - Unsafe metadata returns false so the handler rejects the archive before delivery.
 * Side effects:
 * - Pure validation with no archive or filesystem mutation.
 */
function isArchiveRootMetadataSafe(value: string | null): boolean {
  return (
    value === null ||
    (value.length > 0 &&
      value.length <= 255 &&
      value !== "." &&
      value !== ".." &&
      !/[\\/:]/u.test(value) &&
      !containsControlCharacter(value))
  );
}

/**
 * Business purpose: Detect control bytes that could make a provider archive root ambiguous in headers or filesystem paths.
 * Business rules:
 * - C0 controls and DEL are never valid in trusted wrapper metadata.
 * Execution flow:
 * 1. Inspect each code unit.
 * 2. Reject the first value below U+0020 or equal to U+007F.
 * Failure cases:
 * - Returns true for unsafe values so the caller rejects the archive.
 * Side effects:
 * - Pure validation.
 */
function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
}

/**
 * Business purpose: Preserve the archive transport's three-state root contract across snapshot delivery.
 * Business rules:
 * - A validated wrapper name is VERIFIED_WRAPPER, an explicit null is VERIFIED_ROOTLESS, and absent metadata remains UNKNOWN.
 * Execution flow:
 * 1. Classify only the value returned by the provider transport or cache.
 * 2. Preserve unknown state so the worker must verify it against pinned-tree metadata.
 * Failure cases:
 * - Unverified root metadata cannot authorize stripping; materialization requires a matching pinned-tree manifest.
 * Side effects:
 * - Pure classification; it does not alter archive bytes or persisted snapshot identity.
 */
function archiveRootStatus(
  value: string | null | undefined,
): ArchiveRootVerificationStatus {
  if (typeof value === "string") {
    return ARCHIVE_ROOT_VERIFICATION_STATUSES.verifiedWrapper;
  }
  return value === null
    ? ARCHIVE_ROOT_VERIFICATION_STATUSES.verifiedRootless
    : ARCHIVE_ROOT_VERIFICATION_STATUSES.unknown;
}

/**
 * Business purpose: Ensure cached Azure tree metadata remains bounded and bound to the exact immutable snapshot commit.
 * Business rules:
 * - Only version 1, a matching commit SHA, a valid tree ID, a bounded file count, and a SHA-256 path commitment are accepted.
 * Execution flow:
 * 1. Validate manifest version and commit binding.
 * 2. Validate identifiers and aggregate bounds.
 * 3. Return whether the cache metadata is safe to forward.
 * Failure cases:
 * - Any missing, malformed, mismatched, or excessive field returns false so archive delivery is rejected.
 * Side effects:
 * - Pure metadata validation; it performs no database, cache, or provider operations.
 */
function isPinnedTreeManifestSafe(
  value: PinnedRepositoryTreeManifest,
  commitSha: string,
): boolean {
  return (
    value.version === 1 &&
    value.commitSha.toLowerCase() === commitSha.toLowerCase() &&
    /^[0-9a-f]{40}$/iu.test(value.treeId) &&
    Number.isSafeInteger(value.fileCount) &&
    value.fileCount >= 0 &&
    value.fileCount <= 100_000 &&
    /^[0-9a-f]{64}$/iu.test(value.pathSha256)
  );
}
