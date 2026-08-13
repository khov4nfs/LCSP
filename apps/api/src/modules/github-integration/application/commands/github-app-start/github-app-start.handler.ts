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

@CommandHandler(GitHubAppStartCommand)
export class GitHubAppStartHandler implements ICommandHandler<GitHubAppStartCommand> {
  constructor(
    @Inject(GITHUB_APP_INSTALL_STATE_REPOSITORY)
    private readonly installStateRepository: GitHubAppInstallStateRepository,
    private readonly githubAppClient: GitHubAppClient,
    private readonly auditWriter: AuditWriterService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

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
            organizationId: command.organizationId,
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

      if (!assessment || assessment.organizationId !== command.organizationId) {
        throw problemException(
          ASSESSMENT_ERROR_CODES.notFound,
          command.correlationId,
          { status: HttpStatus.BAD_REQUEST },
        );
      }
    }

    const installState = GitHubAppInstallState.create({
      organizationId: command.organizationId,
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
      organizationId: command.organizationId,
      resourceType: AUDIT_RESOURCE_TYPES.githubAppInstallState,
      resourceId: installState.id,
      correlationId: command.correlationId,
      sessionId: command.sessionId,
      decision: AUDIT_DECISIONS.allow,
      payload: {
        userId: command.userId,
        organizationId: command.organizationId,
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
