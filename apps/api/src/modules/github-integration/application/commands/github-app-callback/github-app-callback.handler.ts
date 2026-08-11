import { HttpStatus, Inject, Logger } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  GITHUB_INTEGRATION_EVENT_TYPES,
  GITHUB_REPOSITORY_PERMISSION_LEVELS,
} from "@lcsp/contracts/github-integration";

import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { RepositoryConnection } from "../../../domain/entities/repository-connection.entity.js";
import {
  GITHUB_APP_INSTALL_STATE_REPOSITORY,
  type GitHubAppInstallStateRepository,
} from "../../ports/persistence/github-app-install-state.repository.js";
import {
  REPOSITORY_CONNECTION_REPOSITORY,
  type RepositoryConnectionRepository,
} from "../../ports/persistence/repository-connection.repository.js";
import { GITHUB_INTEGRATION_ERROR_CODES } from "../../contracts/github-integration/github-app-callback.contract.js";
import type { GitHubAppCallbackDto } from "../../contracts/github-integration/github-app-callback.contract.js";
import { GitHubAppClient } from "../../../infrastructure/github/github-app.client.js";
import { GitHubAppCallbackCommand } from "./github-app-callback.command.js";

const GITHUB_REPOSITORY_PERMISSION_KEYS = {
  contents: "contents",
  metadata: "metadata",
} as const;

@CommandHandler(GitHubAppCallbackCommand)
export class GitHubAppCallbackHandler implements ICommandHandler<GitHubAppCallbackCommand> {
  private readonly logger = new Logger(GitHubAppCallbackHandler.name);

  constructor(
    @Inject(GITHUB_APP_INSTALL_STATE_REPOSITORY)
    private readonly installStateRepository: GitHubAppInstallStateRepository,
    @Inject(REPOSITORY_CONNECTION_REPOSITORY)
    private readonly repositoryConnectionRepository: RepositoryConnectionRepository,
    private readonly githubAppClient: GitHubAppClient,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async execute(
    command: GitHubAppCallbackCommand,
  ): Promise<GitHubAppCallbackDto> {
    const installState = await this.installStateRepository.findByState(
      command.state,
    );
    if (!installState) {
      await this.recordConnectionRejected({
        command,
        reasonCode: GITHUB_INTEGRATION_ERROR_CODES.githubStateInvalid,
      });
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.githubStateInvalid,
        command.correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }

    await this.installStateRepository.deleteById(installState.id);

    if (installState.expiresAt.getTime() < Date.now()) {
      await this.recordConnectionRejected({
        command,
        installState,
        reasonCode: GITHUB_INTEGRATION_ERROR_CODES.githubStateInvalid,
      });
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.githubStateInvalid,
        command.correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }

    let accessToken: string;
    try {
      accessToken = await this.githubAppClient.exchangeCodeForAccessToken(
        command.code,
      );
    } catch (error) {
      this.logger.warn(
        `GitHub App token exchange failed: ${safeGitHubCallbackFailureReason(error)}`,
      );
      await this.recordConnectionRejected({
        command,
        installState,
        reasonCode: GITHUB_INTEGRATION_ERROR_CODES.githubCallbackInvalid,
      });
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.githubCallbackInvalid,
        command.correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }

    let metadata: Awaited<
      ReturnType<GitHubAppClient["fetchInstallationMetadata"]>
    >;
    try {
      metadata = await this.githubAppClient.fetchInstallationMetadata({
        installationId: command.installationId,
        accessToken,
        repositoryId: command.repositoryId,
      });
    } catch (error) {
      this.logger.warn(
        `GitHub App metadata fetch failed: ${safeGitHubCallbackFailureReason(error)}`,
      );
      await this.recordConnectionRejected({
        command,
        installState,
        reasonCode: GITHUB_INTEGRATION_ERROR_CODES.githubCallbackInvalid,
      });
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.githubCallbackInvalid,
        command.correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }

    if (!hasOnlyRequiredReadPermissions(metadata.permissions)) {
      await this.recordConnectionRejected({
        command,
        installState,
        reasonCode: GITHUB_INTEGRATION_ERROR_CODES.permissionsInsufficient,
      });
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.permissionsInsufficient,
        command.correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }

    const repositoriesToConnect = command.repositoryId
      ? [metadata.repository]
      : metadata.repositories;
    const connections = repositoriesToConnect.map((repository) =>
      RepositoryConnection.create({
        assessmentId: installState.assessmentId,
        organizationId: installState.organizationId,
        userId: installState.userId,
        installationId: command.installationId,
        repositoryId: repository.id,
        repositoryName: repository.name,
        repositoryFullName: repository.fullName,
        defaultBranch: repository.defaultBranch,
        permissions: metadata.permissions,
      }),
    );

    for (const connection of connections) {
      await this.repositoryConnectionRepository.save(connection);
    }

    const primaryConnection = connections[0];

    await this.auditWriter.write({
      eventType: GITHUB_INTEGRATION_EVENT_TYPES.appConnected,
      actorId: installState.userId,
      organizationId: installState.organizationId,
      resourceType: AUDIT_RESOURCE_TYPES.repositoryConnection,
      resourceId: primaryConnection.id,
      correlationId: command.correlationId,
      decision: AUDIT_DECISIONS.allow,
      payload: {
        connectionId: primaryConnection.id,
        connectionIds: connections.map((connection) => connection.id),
        repositoryFullName: primaryConnection.repositoryFullName,
        repositoryFullNames: connections.map(
          (connection) => connection.repositoryFullName,
        ),
        organizationId: installState.organizationId,
        userId: installState.userId,
        correlationId: command.correlationId,
      },
    });

    return {
      connection_id: primaryConnection.id,
      repository_name: primaryConnection.repositoryName,
      repository_full_name: primaryConnection.repositoryFullName,
      default_branch: primaryConnection.defaultBranch,
      status: primaryConnection.status,
      correlation_id: command.correlationId,
    };
  }

  private async recordConnectionRejected(input: {
    command: GitHubAppCallbackCommand;
    installState?: {
      id: string;
      userId: string;
      organizationId: string;
      assessmentId: string | null;
    };
    reasonCode: string;
  }): Promise<void> {
    await this.auditWriter.write({
      eventType: GITHUB_INTEGRATION_EVENT_TYPES.appConnectionRejected,
      actorId: input.installState?.userId ?? null,
      organizationId: input.installState?.organizationId ?? null,
      assessmentId: input.installState?.assessmentId ?? null,
      resourceType: AUDIT_RESOURCE_TYPES.githubAppInstallState,
      resourceId: input.installState?.id ?? null,
      reasonCode: input.reasonCode,
      correlationId: input.command.correlationId,
      decision: AUDIT_DECISIONS.deny,
      payload: {
        installationId: input.command.installationId,
        organizationId: input.installState?.organizationId ?? null,
        userId: input.installState?.userId ?? null,
        assessmentId: input.installState?.assessmentId ?? null,
        reasonCode: input.reasonCode,
        correlationId: input.command.correlationId,
      },
    });
  }
}

function hasOnlyRequiredReadPermissions(
  permissions: Record<string, string>,
): boolean {
  if (
    permissions[GITHUB_REPOSITORY_PERMISSION_KEYS.contents] !==
    GITHUB_REPOSITORY_PERMISSION_LEVELS.read
  ) {
    return false;
  }

  return Object.entries(permissions).every(([key, value]) => {
    if (key === GITHUB_REPOSITORY_PERMISSION_KEYS.contents) {
      return value === GITHUB_REPOSITORY_PERMISSION_LEVELS.read;
    }

    return (
      key === GITHUB_REPOSITORY_PERMISSION_KEYS.metadata &&
      value === GITHUB_REPOSITORY_PERMISSION_LEVELS.read
    );
  });
}

function safeGitHubCallbackFailureReason(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "github_app_callback_failed";
}
