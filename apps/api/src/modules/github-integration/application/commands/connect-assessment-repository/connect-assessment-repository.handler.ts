import { HttpStatus, Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  RepositoryAuthenticationMode,
  RepositoryConnectionStatus,
  type Prisma,
} from "@prisma/client";
import {
  CREDENTIAL_PROVIDERS,
  GITHUB_INTEGRATION_ERROR_CODES,
  CREDENTIAL_AUTHORIZATION_STATUSES,
  REPOSITORY_CONNECTION_STATUSES,
} from "@lcsp/contracts/github-integration";
import { ASSESSMENT_STATUS_CODES } from "@lcsp/contracts/assessment";
import { fromPrismaAssessmentStatus } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";

import type { AppConfig } from "../../../../../config/config.types.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import {
  PrismaCredentialPersistenceUnitOfWork,
  type CredentialPersistenceTransaction,
} from "../../../infrastructure/persistence/prisma-credential-persistence.unit-of-work.js";
import {
  ACTIVE_PROVIDER_CREDENTIAL_RESOLVER,
  type ActiveProviderCredentialResolver,
} from "../../ports/security/active-provider-credential.resolver.js";
import {
  REPOSITORY_PROVIDER_REGISTRY,
  type GitHubRepositoryMetadata,
  type RepositoryProviderRegistry,
} from "../../ports/github-repository-provider.port.js";
import {
  parseGitHubRepositoryUrl,
  parseGitLabRepositoryUrl,
  mapProviderFailure,
} from "../github-cli-connect.support.js";
import { ConnectAssessmentRepositoryCommand } from "./connect-assessment-repository.command.js";

@CommandHandler(ConnectAssessmentRepositoryCommand)
export class ConnectAssessmentRepositoryHandler implements ICommandHandler<ConnectAssessmentRepositoryCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly unitOfWork: PrismaCredentialPersistenceUnitOfWork,
    @Inject(ACTIVE_PROVIDER_CREDENTIAL_RESOLVER)
    private readonly credentials: ActiveProviderCredentialResolver,
    @Inject(REPOSITORY_PROVIDER_REGISTRY)
    private readonly providers: RepositoryProviderRegistry,
  ) {}

  async execute(command: ConnectAssessmentRepositoryCommand) {
    if (
      !this.config.get("githubCredentialPersistence", { infer: true }).enabled
    ) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.cliConnectDisabled,
        command.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    const assessment = await this.prisma.assessment.findFirst({
      where: {
        id: command.assessmentId,
        ownerId: command.userId,
      },
      select: { id: true, status: true },
    });
    if (!assessment) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.connectionNotFound,
        command.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    if (
      fromPrismaAssessmentStatus(assessment.status) !==
      ASSESSMENT_STATUS_CODES.wizardSubmitted
    ) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.assessmentStateInvalid,
        command.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    const github = parseGitHubRepositoryUrl(command.repositoryUrl);
    const gitlab = parseGitLabRepositoryUrl(command.repositoryUrl);
    const provider = github
      ? CREDENTIAL_PROVIDERS.github
      : gitlab
        ? CREDENTIAL_PROVIDERS.gitlab
        : null;
    const locator = github ?? gitlab;
    if (!provider || !locator) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.credentialRequestInvalid,
        command.correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }
    const resolved = await this.credentials.resolveActiveCredential({
      userId: command.userId,
      provider,
      repositoryFullName: locator.repositoryFullName,
    });
    const { metadata, lease } = resolved;
    try {
      const adapter = this.providers.get(provider);
      let repository: GitHubRepositoryMetadata;
      try {
        repository = await adapter.validateRepositoryAccess(
          lease,
          locator.repositoryFullName,
          true,
        );
      } catch (error: unknown) {
        mapProviderFailure(error, command.correlationId);
      }
      const mode =
        provider === CREDENTIAL_PROVIDERS.github
          ? RepositoryAuthenticationMode.GITHUB_CLI_CREDENTIAL
          : RepositoryAuthenticationMode.GITLAB_CLI_CREDENTIAL;
      const existing = await this.prisma.repositoryConnection.findFirst({
        where: {
          assessmentId: command.assessmentId,
          userId: command.userId,
          repositoryId: repository.id,
          authenticationMode: mode,
          status: RepositoryConnectionStatus.ACTIVE,
        },
        select: { id: true },
      });
      if (existing)
        return {
          connectionId: existing.id,
          provider,
          repositoryId: repository.id,
          repositoryFullName: repository.fullName,
          defaultBranch: repository.defaultBranch,
          status: REPOSITORY_CONNECTION_STATUSES.active,
        };
      const connectionId = crypto.randomUUID();
      const now = new Date();
      await this.unitOfWork.execute(async (transaction) => {
        await this.persistRepositoryConnection(transaction, {
          id: connectionId,
          assessmentId: command.assessmentId,
          userId: command.userId,
          provider,
          installationId: null,
          authenticationMode: mode,
          providerCredentialId: metadata.id,
          credentialVersion: metadata.currentVersion,
          credentialAuthorizedByUserId: command.userId,
          credentialAuthorizationStatus:
            CREDENTIAL_AUTHORIZATION_STATUSES.active,
          credentialValidatedAt: now,
          credentialRevokedAt: null,
          repositoryId: repository.id,
          repositoryName: repository.name,
          repositoryFullName: repository.fullName,
          defaultBranch: repository.defaultBranch,
          permissions: {},
          status: RepositoryConnectionStatus.ACTIVE,
          connectedAt: now,
        });
      });
      return {
        connectionId,
        provider,
        repositoryId: repository.id,
        repositoryFullName: repository.fullName,
        defaultBranch: repository.defaultBranch,
        status: REPOSITORY_CONNECTION_STATUSES.active,
      };
    } finally {
      lease.dispose();
    }
  }

  protected persistRepositoryConnection(
    transaction: CredentialPersistenceTransaction,
    data: Prisma.RepositoryConnectionCreateArgs["data"],
  ): Promise<unknown> {
    return transaction.database.repositoryConnection.create({ data });
  }
}
