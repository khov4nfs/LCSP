import { HttpStatus, Inject, Logger } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

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
  REPOSITORY_CONNECTION_STATUSES,
} from "@lcsp/contracts/github-integration";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { SUBJECT_ROLES } from "@lcsp/contracts/pbac";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { RepositorySnapshot } from "../../../domain/entities/repository-snapshot.entity.js";
import {
  GitHubAppClient,
  GitHubAppClientError,
} from "../../../infrastructure/github/github-app.client.js";
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

/**
 * Resolves an authorized Git revision to an immutable commit and persists an assessment-bound repository snapshot plus outbox/audit evidence.
 */
@CommandHandler(PinSnapshotCommand)
export class PinSnapshotHandler implements ICommandHandler<PinSnapshotCommand> {
  private readonly logger = new Logger(PinSnapshotHandler.name);

  /**
   * Creates the snapshot handler with connection/snapshot persistence, GitHub resolution, tenant lookup, and audit dependencies.
   *
   * @param connectionRepository - Repository used to resolve the active GitHub repository connection.
   * @param snapshotRepository - Repository used to atomically persist the snapshot and created outbox event.
   * @param githubAppClient - GitHub App client used to resolve a branch/ref/SHA to an exact repository commit.
   * @param prisma - Prisma service used to validate assessment ownership.
   * @param auditWriter - Audit writer used to record allowed and denied pin attempts.
   */
  constructor(
    @Inject(REPOSITORY_CONNECTION_REPOSITORY)
    private readonly connectionRepository: RepositoryConnectionRepository,
    @Inject(REPOSITORY_SNAPSHOT_REPOSITORY)
    private readonly snapshotRepository: RepositorySnapshotRepository,
    private readonly githubAppClient: GitHubAppClient,
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  /**
   * Validates tenant/PBAC scope and revision syntax, resolves the exact GitHub commit, persists the immutable snapshot, and audits the result.
   *
   * @param command - Assessment, actor/PBAC, repository connection, revision selectors, and correlation context.
   * @returns Persisted snapshot metadata including the immutable commit SHA.
   * @throws When the connection/assessment is unavailable, authorization fails, or the requested revision cannot be safely resolved.
   */
  async execute(command: PinSnapshotCommand): Promise<PinSnapshotDto> {
    const connectionId = clean(command.connectionId);
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: command.assessmentId },
      select: { id: true, organizationId: true, ownerId: true },
    });
    const connection = connectionId
      ? await this.connectionRepository.findById(connectionId)
      : null;

    if (
      !assessment ||
      assessment.organizationId !== command.organizationId ||
      !connection ||
      connection.organizationId !== command.organizationId ||
      connection.status !== REPOSITORY_CONNECTION_STATUSES.active
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

    const isManagerOwner =
      command.subjectRole === SUBJECT_ROLES.manager &&
      assessment.ownerId === command.actorId;
    const isScopedDeveloper =
      command.subjectRole === SUBJECT_ROLES.developer &&
      command.scope === command.assessmentId;
    if (!isManagerOwner && !isScopedDeveloper) {
      await this.auditDenied(command, AUTH_ERROR_CODES.pbacDenied);
      throw problemException(
        AUTH_ERROR_CODES.pbacDenied,
        command.correlationId,
        {
          status: HttpStatus.FORBIDDEN,
        },
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

    let resolved: Awaited<ReturnType<GitHubAppClient["resolveCommit"]>>;
    try {
      resolved = await this.githubAppClient.resolveCommit({
        installationId: connection.installationId,
        repositoryFullName: connection.repositoryFullName,
        revision,
      });
    } catch (error) {
      const reasonCode = isInstallationAccessFailure(
        error,
        !commitSha && !ref && revision === connection.defaultBranch,
      )
        ? GITHUB_INTEGRATION_ERROR_CODES.permissionsInsufficient
        : GITHUB_INTEGRATION_ERROR_CODES.refNotResolvable;
      this.logger.warn(
        `GitHub snapshot resolution failed: ${safeGitHubSnapshotFailureReason(error)}`,
      );
      await this.auditDenied(command, reasonCode);
      throw problemException(reasonCode, command.correlationId, {
        status: HttpStatus.BAD_REQUEST,
      });
    }

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

    const snapshot = RepositorySnapshot.create({
      assessmentId: command.assessmentId,
      organizationId: command.organizationId,
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
        organizationId: snapshot.organizationId,
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

    await this.auditWriter.write({
      eventType: GITHUB_INTEGRATION_EVENT_TYPES.snapshotCreatedAudit,
      actorId: command.actorId,
      organizationId: command.organizationId,
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

  /**
   * Writes a denial audit event for snapshot pin failures before the handler throws the external problem.
   *
   * @param command - Snapshot command containing actor, tenant, connection, and correlation context.
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
      organizationId: command.organizationId,
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

/**
 * Determines whether a GitHub commit-resolution error indicates installation permission/access failure rather than a bad ref.
 *
 * @param error - Unknown GitHub resolution error.
 * @param isDefaultBranchRequest - Whether the failed revision was the connection's default branch.
 * @returns True when the upstream status should be mapped to insufficient installation permissions.
 */
function isInstallationAccessFailure(
  error: unknown,
  isDefaultBranchRequest: boolean,
): boolean {
  if (!(error instanceof GitHubAppClientError)) {
    return false;
  }

  return (
    error.status === HttpStatus.UNAUTHORIZED ||
    error.status === HttpStatus.FORBIDDEN ||
    (error.status === HttpStatus.NOT_FOUND && isDefaultBranchRequest)
  );
}

/**
 * Formats a safe diagnostic reason for GitHub snapshot resolution failures.
 *
 * @param error - Unknown GitHub resolution error.
 * @returns Stable fallback text or typed client message optionally suffixed with upstream status.
 */
function safeGitHubSnapshotFailureReason(error: unknown): string {
  if (!(error instanceof GitHubAppClientError)) {
    return "github_snapshot_resolution_failed";
  }

  return error.status === null
    ? error.message
    : `${error.message}:${error.status}`;
}
