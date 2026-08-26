import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import { HttpStatus, Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ICommandHandler } from "@nestjs/cqrs";
import { CommandHandler } from "@nestjs/cqrs";

import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import {
  GITHUB_INTEGRATION_ERROR_CODES,
  GITHUB_INTEGRATION_EVENT_TYPES,
} from "@lcsp/contracts/github-integration";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { GitHubAppInstallState } from "../../../domain/entities/github-app-install-state.entity.js";
import { GitHubAppClient } from "../../../infrastructure/github/github-app.client.js";
import type { GitHubAppStartDto } from "../../contracts/github-integration/github-app-start.contract.js";
import {
  GITHUB_APP_INSTALL_STATE_REPOSITORY,
  type GitHubAppInstallStateRepository,
} from "../../ports/persistence/github-app-install-state.repository.js";
import { GitHubAppStartCommand } from "./github-app-start.command.js";

const INSTALL_STATE_TTL_MS = 10 * 60_000;

/**
 * Starts a GitHub App installation flow after validating redirect, assessment, and optional reconnect context.
 */
@CommandHandler(GitHubAppStartCommand)
export class GitHubAppStartHandler implements ICommandHandler<GitHubAppStartCommand> {
  /**
   * Creates the handler with installation-state persistence, GitHub URL construction, audit, configuration, and assessment lookup dependencies.
   *
   * @param installStateRepository - Repository used to persist the short-lived opaque installation state.
   * @param githubAppClient - GitHub App client used to construct the installation authorization URL.
   * @param auditWriter - Audit writer used to record installation-flow initiation.
   * @param configService - Configuration service used to validate allowed client redirect URIs.
   * @param prisma - Prisma service used to validate existing connections and assessment ownership.
   */
  constructor(
    @Inject(GITHUB_APP_INSTALL_STATE_REPOSITORY)
    private readonly installStateRepository: GitHubAppInstallStateRepository,
    private readonly githubAppClient: GitHubAppClient,
    private readonly auditWriter: AuditWriterService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Validates the installation request, persists expiring state, builds the GitHub URL, and records the start audit event.
   *
   * @param command - User/session, redirect, optional assessment, reconnect installation, and correlation context.
   * @returns GitHub installation URL and correlation identifier.
   * @throws When the redirect URI is not allowlisted, reconnect installation is unavailable, or the assessment cannot be found.
   */
  async execute(command: GitHubAppStartCommand): Promise<GitHubAppStartDto> {
    const redirectUri = command.redirectUri?.trim();
    const allowedRedirectUris = this.configService.get<string[]>(
      "github.allowedRedirectUris",
      [],
    );

    if (!redirectUri || !allowedRedirectUris.includes(redirectUri)) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.invalidRedirectUri,
        command.correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }

    const existingConnection = command.installationId
      ? await this.prisma.repositoryConnection.findFirst({
          where: {
            installationId: command.installationId,
            userId: command.userId,
            revokedAt: null,
          },
          select: { assessmentId: true },
        })
      : null;

    if (command.installationId && !existingConnection) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.connectionNotFound,
        command.correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }

    const assessmentId =
      command.assessmentId ?? existingConnection?.assessmentId;

    if (assessmentId) {
      const assessment = await this.prisma.assessment.findUnique({
        where: { id: assessmentId },
      });

      if (!assessment) {
        throw problemException(
          ASSESSMENT_ERROR_CODES.notFound,
          command.correlationId,
          { status: HttpStatus.BAD_REQUEST },
        );
      }
    }

    const installState = GitHubAppInstallState.create({
      userId: command.userId,
      redirectUri,
      assessmentId: assessmentId ?? null,
      ttlMs: INSTALL_STATE_TTL_MS,
    });
    await this.installStateRepository.save(installState);

    const installationUrl = this.githubAppClient.buildInstallationUrl({
      state: installState.state,
      redirectUri,
    });

    await this.auditWriter.write({
      eventType: GITHUB_INTEGRATION_EVENT_TYPES.appInstallStarted,
      actorId: command.userId,
      resourceType: AUDIT_RESOURCE_TYPES.githubAppInstallState,
      resourceId: installState.id,
      correlationId: command.correlationId,
      sessionId: command.sessionId,
      decision: AUDIT_DECISIONS.allow,
      payload: {
        userId: command.userId,
        assessmentId: assessmentId ?? null,
        installationId: command.installationId ?? null,
        correlationId: command.correlationId,
      },
    });

    return {
      installation_url: installationUrl,
      correlationId: command.correlationId,
    };
  }
}
