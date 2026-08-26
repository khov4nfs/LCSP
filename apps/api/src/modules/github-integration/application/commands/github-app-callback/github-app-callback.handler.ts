import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  GITHUB_INTEGRATION_EVENT_TYPES,
  GITHUB_REPOSITORY_PERMISSION_LEVELS,
} from "@lcsp/contracts/github-integration";
import { HttpStatus, Inject, Logger } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { RepositoryConnection } from "../../../domain/entities/repository-connection.entity.js";
import { GitHubAppClient } from "../../../infrastructure/github/github-app.client.js";
import type { GitHubAppCallbackDto } from "../../contracts/github-integration/github-app-callback.contract.js";
import { GITHUB_INTEGRATION_ERROR_CODES } from "../../contracts/github-integration/github-app-callback.contract.js";
import {
  GITHUB_APP_INSTALL_STATE_REPOSITORY,
  type GitHubAppInstallStateRepository,
} from "../../ports/persistence/github-app-install-state.repository.js";
import {
  REPOSITORY_CONNECTION_REPOSITORY,
  type RepositoryConnectionRepository,
} from "../../ports/persistence/repository-connection.repository.js";
import { GitHubAppCallbackCommand } from "./github-app-callback.command.js";

const GITHUB_REPOSITORY_PERMISSION_KEYS = {
  contents: "contents",
  metadata: "metadata",
} as const;

/**
 * Completes the GitHub App callback by consuming installation state, validating permissions, and persisting repository connections.
 */
@CommandHandler(GitHubAppCallbackCommand)
export class GitHubAppCallbackHandler implements ICommandHandler<GitHubAppCallbackCommand> {
  private readonly logger = new Logger(GitHubAppCallbackHandler.name);

  /**
   * Creates the callback handler with installation state, repository persistence, GitHub API, and audit dependencies.
   *
   * @param installStateRepository - Repository used to consume and delete the opaque callback state.
   * @param repositoryConnectionRepository - Repository used to persist connected GitHub repositories.
   * @param githubAppClient - Client used to exchange the callback code and fetch installation metadata.
   * @param auditWriter - Audit writer used to record successful and rejected connection attempts.
   */
  constructor(
    @Inject(GITHUB_APP_INSTALL_STATE_REPOSITORY)
    private readonly installStateRepository: GitHubAppInstallStateRepository,
    @Inject(REPOSITORY_CONNECTION_REPOSITORY)
    private readonly repositoryConnectionRepository: RepositoryConnectionRepository,
    private readonly githubAppClient: GitHubAppClient,
    private readonly auditWriter: AuditWriterService,
  ) {}

  /**
   * Verifies callback state/TTL, exchanges credentials, enforces read-only permissions, connects selected repositories, and audits the outcome.
   *
   * @param command - Installation ID, callback code/state, optional repository selection, and correlation context.
   * @returns Primary connected repository metadata for the callback response.
   * @throws When callback state is invalid/expired, token or metadata exchange fails, or installation permissions exceed the allowed read-only set.
   */
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
      correlationId: command.correlationId,
    };
  }

  /**
   * Records a failed GitHub App connection attempt with only safe installation/context metadata.
   *
   * @param input - Callback command, optional recovered installation state, and stable rejection reason code.
   * @returns A promise that resolves after the rejection audit event is written.
   */
  private async recordConnectionRejected(input: {
    command: GitHubAppCallbackCommand;
    installState?: {
      id: string;
      userId: string;
      assessmentId: string | null;
    };
    reasonCode: string;
  }): Promise<void> {
    await this.auditWriter.write({
      eventType: GITHUB_INTEGRATION_EVENT_TYPES.appConnectionRejected,
      actorId: input.installState?.userId ?? null,
      assessmentId: input.installState?.assessmentId ?? null,
      resourceType: AUDIT_RESOURCE_TYPES.githubAppInstallState,
      resourceId: input.installState?.id ?? null,
      reasonCode: input.reasonCode,
      correlationId: input.command.correlationId,
      decision: AUDIT_DECISIONS.deny,
      payload: {
        installationId: input.command.installationId,
        userId: input.installState?.userId ?? null,
        assessmentId: input.installState?.assessmentId ?? null,
        reasonCode: input.reasonCode,
        correlationId: input.command.correlationId,
      },
    });
  }
}

/**
 * Ensures the GitHub installation exposes only the required read permissions for contents and metadata.
 *
 * @param permissions - Permission map returned by the GitHub installation API.
 * @returns True when contents is read-only and every granted permission is an allowed read-only key.
 */
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

/**
 * Produces a safe diagnostic reason for callback failures without assuming the thrown value is an Error.
 *
 * @param error - Unknown callback failure value.
 * @returns Error message when available, otherwise a stable fallback label.
 */
function safeGitHubCallbackFailureReason(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "github_app_callback_failed";
}
