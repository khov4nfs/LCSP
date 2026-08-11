import { HttpStatus, Inject, Logger } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import {
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
  AUDIT_ACTOR_TYPES,
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

@CommandHandler(PinSnapshotCommand)
export class PinSnapshotHandler implements ICommandHandler<PinSnapshotCommand> {
  private readonly logger = new Logger(PinSnapshotHandler.name);

  constructor(
    @Inject(REPOSITORY_CONNECTION_REPOSITORY)
    private readonly connectionRepository: RepositoryConnectionRepository,
    @Inject(REPOSITORY_SNAPSHOT_REPOSITORY)
    private readonly snapshotRepository: RepositorySnapshotRepository,
    private readonly githubAppClient: GitHubAppClient,
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

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
      correlation_id: command.correlationId,
    };
  }

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

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

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

function safeGitHubSnapshotFailureReason(error: unknown): string {
  if (!(error instanceof GitHubAppClientError)) {
    return "github_snapshot_resolution_failed";
  }

  return error.status === null
    ? error.message
    : `${error.message}:${error.status}`;
}
