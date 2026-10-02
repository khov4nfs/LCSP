import { HttpStatus, Inject, Logger, Optional } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import {
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import { AUTH_ERROR_CODES, AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { ASSESSMENT_STATUS_CODES } from "@lcsp/contracts/assessment";
import {
  GITHUB_INTEGRATION_ERROR_CODES,
  GITHUB_INTEGRATION_EVENT_TYPES,
  GITHUB_CREDENTIAL_ERROR_CODES,
  GITHUB_CREDENTIAL_OPERATIONS,
  REPOSITORY_AUTHENTICATION_MODES,
  REPOSITORY_CONNECTION_STATUSES,
  type GitHubCredentialErrorCode,
} from "@lcsp/contracts/github-integration";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { RepositorySnapshot } from "../../../domain/entities/repository-snapshot.entity.js";
import { GitHubCliProviderError } from "../../../infrastructure/github/github-cli-repository.provider.js";
import type { PinSnapshotDto } from "../../contracts/github-integration/pin-snapshot.contract.js";
import {
  REPOSITORY_CONNECTION_REPOSITORY,
  type RepositoryConnectionRepository,
} from "../../ports/persistence/repository-connection.repository.js";
import {
  REPOSITORY_SNAPSHOT_REPOSITORY,
  type RepositorySnapshotRepository,
} from "../../ports/persistence/repository-snapshot.repository.js";
import { PinSnapshotCommand } from "./pin-snapshot.command.js";
import {
  CREDENTIAL_AUTHORIZATION_RESOLVER,
  type CredentialAuthorizationResolverPort,
} from "../../ports/security/credential-authorization-resolver.port.js";
import {
  GITHUB_REPOSITORY_PROVIDER,
  type GitHubRepositoryProviderPort,
  type GitHubResolvedCommit,
  REPOSITORY_PROVIDER_REGISTRY,
  type RepositoryProviderRegistry,
} from "../../ports/github-repository-provider.port.js";
import { CredentialResolutionError } from "../../../infrastructure/persistence/prisma-credential-authorization.resolver.js";
import type { CredentialLease } from "../../security/credential-lease.js";

/**
 * Resolves an authorized Git revision to an immutable commit and persists an assessment-bound repository snapshot plus outbox/audit evidence.
 */
@CommandHandler(PinSnapshotCommand)
export class PinSnapshotHandler implements ICommandHandler<PinSnapshotCommand> {
  private readonly logger = new Logger(PinSnapshotHandler.name);

  /**
   * Creates the snapshot handler with connection/snapshot persistence, GitHub resolution, assessment lookup, and audit dependencies.
   *
   * @param connectionRepository - Repository used to resolve the active GitHub repository connection.
   * @param snapshotRepository - Repository used to atomically persist the snapshot and created outbox event.
   * @param prisma - Prisma service used to validate assessment ownership.
   * @param auditWriter - Audit writer used to record allowed and denied pin attempts.
   */
  constructor(
    @Inject(REPOSITORY_CONNECTION_REPOSITORY)
    private readonly connectionRepository: RepositoryConnectionRepository,
    @Inject(REPOSITORY_SNAPSHOT_REPOSITORY)
    private readonly snapshotRepository: RepositorySnapshotRepository,
    @Inject(CREDENTIAL_AUTHORIZATION_RESOLVER)
    private readonly credentialResolver: CredentialAuthorizationResolverPort,
    @Inject(GITHUB_REPOSITORY_PROVIDER)
    private readonly githubRepositoryProvider: GitHubRepositoryProviderPort,
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
    @Inject(REPOSITORY_PROVIDER_REGISTRY)
    @Optional()
    private readonly providerRegistry?: RepositoryProviderRegistry,
  ) {}

  /**
   * Validates RBAC scope and revision syntax, resolves the exact GitHub commit, persists the immutable snapshot, and audits the result.
   *
   * @param command - Assessment, actor/RBAC, repository connection, revision selectors, and correlation context.
   * @returns Persisted snapshot metadata including the immutable commit SHA.
   * @throws When the connection/assessment is unavailable, authorization fails, or the requested revision cannot be safely resolved.
   */
  async execute(command: PinSnapshotCommand): Promise<PinSnapshotDto> {
    const connectionId = clean(command.connectionId);
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: command.assessmentId },
      select: { id: true, ownerId: true, status: true },
    });
    if (!assessment) {
      await this.auditDenied(
        command,
        GITHUB_INTEGRATION_ERROR_CODES.connectionNotFound,
      );
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.connectionNotFound,
        command.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const isCustomerOwner =
      command.subjectRole === AUTH_USER_ROLES.customer &&
      assessment.ownerId === command.actorId;
    if (!isCustomerOwner) {
      await this.auditDenied(command, AUTH_ERROR_CODES.rbacDenied);
      throw problemException(
        AUTH_ERROR_CODES.rbacDenied,
        command.correlationId,
        {
          status: HttpStatus.FORBIDDEN,
        },
      );
    }
    if (assessment.status !== ASSESSMENT_STATUS_CODES.wizardInProgress) {
      await this.auditDenied(
        command,
        GITHUB_INTEGRATION_ERROR_CODES.assessmentStateInvalid,
      );
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.assessmentStateInvalid,
        command.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }

    const connection = connectionId
      ? await this.connectionRepository.findById(connectionId)
      : null;
    if (
      !connection ||
      connection.status !== REPOSITORY_CONNECTION_STATUSES.active ||
      connection.userId !== command.actorId ||
      (connection.assessmentId !== null &&
        connection.assessmentId !== command.assessmentId)
    ) {
      await this.auditDenied(
        command,
        GITHUB_INTEGRATION_ERROR_CODES.connectionNotFound,
      );
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.connectionNotFound,
        command.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const branch = clean(command.branch);
    const ref = clean(command.ref);
    const commitSha = clean(command.commitSha);
    if (commitSha && !/^[0-9a-f]{40}$/i.test(commitSha)) {
      await this.auditDenied(
        command,
        GITHUB_INTEGRATION_ERROR_CODES.refNotResolvable,
      );
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.refNotResolvable,
        command.correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }
    const revision = commitSha ?? ref ?? branch ?? connection.defaultBranch;

    const resolved = await this.resolveCommit(command, connection, revision);

    if (resolved.repositoryFullName !== connection.repositoryFullName) {
      await this.auditDenied(
        command,
        GITHUB_INTEGRATION_ERROR_CODES.refOutOfScope,
      );
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.refOutOfScope,
        command.correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }
    if (!/^[0-9a-f]{40}$/iu.test(resolved.sha)) {
      await this.auditDenied(
        command,
        GITHUB_INTEGRATION_ERROR_CODES.refNotResolvable,
      );
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.refNotResolvable,
        command.correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }

    const snapshot = RepositorySnapshot.create({
      assessmentId: command.assessmentId,
      connectionId: connection.id,
      repositoryId: connection.repositoryId,
      repositoryFullName: connection.repositoryFullName,
      branch,
      ref,
      commitSha: resolved.sha,
      providerMetadata: {
        authorDate: resolved.authorDate,
        committerDate: resolved.committerDate,
        htmlUrl: resolved.htmlUrl,
        requestedRevision: revision,
      },
      actorId: command.actorId,
    });

    await this.snapshotRepository.saveWithCreatedEvent(
      snapshot,
      buildOutboxMessageInput({
        aggregateType: OUTBOX_AGGREGATE_TYPES.repositorySnapshot,
        aggregateId: snapshot.id,
        eventType: GITHUB_INTEGRATION_EVENT_TYPES.snapshotCreated,
        assessmentId: snapshot.assessmentId,
        correlationId: command.correlationId,
        causationId: command.correlationId,
        actor: { id: command.actorId, type: AUDIT_ACTOR_TYPES.user },
        result: GITHUB_INTEGRATION_EVENT_TYPES.snapshotCreatedAudit,
        redactionStatus: AUDIT_REDACTION_STATUSES.none,
        idempotencyKey: `${snapshot.id}:${GITHUB_INTEGRATION_EVENT_TYPES.snapshotCreated}`,
        payload: {
          snapshotId: snapshot.id,
          assessmentId: snapshot.assessmentId,
          commitSha: snapshot.commitSha,
          connectionId: snapshot.connectionId,
          correlationId: command.correlationId,
        },
      }),
    );
    await this.prisma.assessment.updateMany({
      where: {
        id: command.assessmentId,
        ownerId: command.actorId,
        status: ASSESSMENT_STATUS_CODES.wizardInProgress,
      },
      data: { repositorySetupVersion: { increment: 1 } },
    });

    await this.auditWriter.write({
      eventType: GITHUB_INTEGRATION_EVENT_TYPES.snapshotCreatedAudit,
      actorId: command.actorId,
      assessmentId: snapshot.assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.repositorySnapshot,
      resourceId: snapshot.id,
      correlationId: command.correlationId,
      causationId: command.correlationId,
      decision: AUDIT_DECISIONS.allow,
      result: GITHUB_INTEGRATION_EVENT_TYPES.snapshotCreatedAudit,
      redactionStatus: AUDIT_REDACTION_STATUSES.none,
      payload: {
        snapshotId: snapshot.id,
        assessmentId: snapshot.assessmentId,
        commitSha: snapshot.commitSha,
        connectionId: snapshot.connectionId,
        correlationId: command.correlationId,
      },
    });

    return {
      snapshot_id: snapshot.id,
      repository_full_name: snapshot.repositoryFullName,
      commit_sha: snapshot.commitSha,
      branch: snapshot.branch,
      status: snapshot.status,
      created_at: snapshot.createdAt.toISOString(),
      correlationId: command.correlationId,
    };
  }

  private async resolveCommit(
    command: PinSnapshotCommand,
    connection: NonNullable<
      Awaited<ReturnType<RepositoryConnectionRepository["findById"]>>
    >,
    revision: string,
  ): Promise<GitHubResolvedCommit> {
    switch (connection.authenticationMode) {
      case REPOSITORY_AUTHENTICATION_MODES.githubApp: {
        // Retired GitHub App connections are no longer resolvable; fail clearly.
        await this.auditDenied(
          command,
          GITHUB_INTEGRATION_ERROR_CODES.repositoryAuthenticationModeUnsupported,
        );
        throw problemException(
          GITHUB_INTEGRATION_ERROR_CODES.repositoryAuthenticationModeUnsupported,
          command.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }

      case REPOSITORY_AUTHENTICATION_MODES.githubCliCredential:
      case REPOSITORY_AUTHENTICATION_MODES.gitlabCliCredential:
      case REPOSITORY_AUTHENTICATION_MODES.bitbucketCliCredential:
      case REPOSITORY_AUTHENTICATION_MODES.azureDevOpsCliCredential:
        if (
          connection.installationIdOrNull !== null ||
          connection.providerCredentialId == null
        ) {
          return this.failClosedMode(command);
        }
        return this.resolveCliCommit(command, connection, revision);

      default:
        return this.failClosedMode(command);
    }
  }

  private async resolveCliCommit(
    command: PinSnapshotCommand,
    connection: NonNullable<
      Awaited<ReturnType<RepositoryConnectionRepository["findById"]>>
    >,
    revision: string,
  ): Promise<GitHubResolvedCommit> {
    let lease: CredentialLease | undefined;
    try {
      lease = await this.credentialResolver.resolveForConnection(
        {
          actorId: command.actorId,
          userId: command.actorId,
          assessmentId: command.assessmentId,
          operation: GITHUB_CREDENTIAL_OPERATIONS.pinSnapshot,
          correlationId: command.correlationId,
        },
        connection.id,
        connection.repositoryFullName,
      );
      const provider =
        this.providerRegistry?.get(connection.provider) ??
        this.githubRepositoryProvider;
      return await provider.resolveCommit(
        lease,
        connection.repositoryFullName,
        revision,
      );
    } catch (error: unknown) {
      const category = cliFailureCategory(error);
      if (
        lease &&
        category === GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid
      ) {
        await this.credentialResolver.markInvalid(
          connection.id,
          lease.credentialVersion,
          category,
        );
      }
      await this.auditDenied(command, category);
      throw problemException(category, command.correlationId, {
        status: cliFailureStatus(category),
      });
    } finally {
      lease?.dispose();
    }
  }

  private async failClosedMode(command: PinSnapshotCommand): Promise<never> {
    await this.auditDenied(
      command,
      GITHUB_INTEGRATION_ERROR_CODES.connectionNotFound,
    );
    throw problemException(
      GITHUB_INTEGRATION_ERROR_CODES.connectionNotFound,
      command.correlationId,
      { status: HttpStatus.NOT_FOUND },
    );
  }

  /**
   * Writes a denial audit event for snapshot pin failures before the handler throws the external problem.
   *
   * @param command - Snapshot command containing actor, connection, and correlation context.
   * @param reasonCode - Stable reason explaining the rejected pin attempt.
   * @returns A promise that resolves after the denial audit event is written.
   */
  private async auditDenied(
    command: PinSnapshotCommand,
    reasonCode: string,
  ): Promise<void> {
    await this.auditWriter.write({
      eventType: GITHUB_INTEGRATION_EVENT_TYPES.snapshotPinFailedAudit,
      actorId: command.actorId,
      resourceType: AUDIT_RESOURCE_TYPES.repositoryConnection,
      resourceId: clean(command.connectionId) ?? command.assessmentId,
      correlationId: command.correlationId,
      decision: AUDIT_DECISIONS.deny,
      payload: {
        assessmentId: command.assessmentId,
        connectionId: command.connectionId,
        reasonCode,
        correlationId: command.correlationId,
      },
    });
  }
}

/**
 * Normalizes a non-empty string without coercing other runtime types.
 *
 * @param value - Unknown value to normalize.
 * @returns Trimmed string, or null for empty/non-string input.
 */
function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function cliFailureCategory(error: unknown): GitHubCredentialErrorCode {
  if (error instanceof GitHubCliProviderError) return error.category;
  if (error instanceof CredentialResolutionError) return error.code;
  return GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid;
}

function cliFailureStatus(category: GitHubCredentialErrorCode): number {
  const statuses: Record<GitHubCredentialErrorCode, number> = {
    [GITHUB_CREDENTIAL_ERROR_CODES.credentialRequired]: HttpStatus.BAD_REQUEST,
    [GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid]: HttpStatus.UNAUTHORIZED,
    [GITHUB_CREDENTIAL_ERROR_CODES.credentialExpired]: HttpStatus.UNAUTHORIZED,
    [GITHUB_CREDENTIAL_ERROR_CODES.credentialApprovalRequired]:
      HttpStatus.FORBIDDEN,
    [GITHUB_CREDENTIAL_ERROR_CODES.repositoryAccessDenied]:
      HttpStatus.NOT_FOUND,
    [GITHUB_CREDENTIAL_ERROR_CODES.repositoryUnavailable]: HttpStatus.NOT_FOUND,
    [GITHUB_CREDENTIAL_ERROR_CODES.providerRateLimited]:
      HttpStatus.TOO_MANY_REQUESTS,
    [GITHUB_CREDENTIAL_ERROR_CODES.providerTimeout]: HttpStatus.GATEWAY_TIMEOUT,
    [GITHUB_CREDENTIAL_ERROR_CODES.operationCancelled]: 499,
    [GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable]:
      HttpStatus.SERVICE_UNAVAILABLE,
    [GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid]:
      HttpStatus.BAD_GATEWAY,
  };
  return statuses[category];
}
