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
  GITHUB_CREDENTIAL_ERROR_CODES,
  GITHUB_INTEGRATION_ERROR_CODES,
  CREDENTIAL_AUTHORIZATION_STATUSES,
  REPOSITORY_CONNECTION_STATUSES,
  PROVIDER_CREDENTIAL_STATUSES,
} from "@lcsp/contracts/github-integration";
import { ASSESSMENT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";

import type { AppConfig } from "../../../../../config/config.types.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import {
  PrismaCredentialPersistenceUnitOfWork,
  type CredentialPersistenceTransaction,
} from "../../../infrastructure/persistence/prisma-credential-persistence.unit-of-work.js";
import {
  ACTIVE_PROVIDER_CREDENTIAL_RESOLVER,
  type ActiveProviderCredentialResolver,
  type ResolvedActiveProviderCredential,
} from "../../ports/security/active-provider-credential.resolver.js";
import {
  REPOSITORY_PROVIDER_REGISTRY,
  type GitHubRepositoryMetadata,
  type RepositoryProviderAdapter,
  type RepositoryProviderRegistry,
} from "../../ports/github-repository-provider.port.js";
import {
  parseGitHubRepositoryUrl,
  parseGitLabRepositoryUrl,
  parseBitbucketRepositoryUrl,
  parseAzureDevOpsRepositoryUrl,
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

  /**
   * Business purpose: Connect or explicitly reauthorize one repository for its assessment owner.
   * Business rules:
   * - The caller must own an editable assessment and the selected provider must be registered.
   * - A replacement credential is bound only after it proves access to the repository.
   * Execution flow:
   * 1. Validate the assessment and shared URL locator, and select the provider before reading a credential.
   * 2. Validate repository access, then create or explicitly rebind one version-pinned connection.
   * Failure cases:
   * - Unsupported providers, missing or invalid credentials, stale credential snapshots, invalid URLs, inaccessible repositories, and concurrent binding changes fail with classified problem responses.
   * Side effects:
   * - May call the selected provider, persist a new connection or update an explicitly reauthorized binding, and dispose the credential lease.
   */
  async execute(command: ConnectAssessmentRepositoryCommand) {
    const assessment = await this.prisma.assessment.findFirst({
      where: { id: command.assessmentId, ownerId: command.userId },
      select: { id: true, lifecycleState: true },
    });
    if (!assessment) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.assessmentStateInvalid,
        command.correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }
    if (
      assessment.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.CREATED &&
      assessment.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.PREPARING &&
      assessment.lifecycleState !==
        ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_REQUIRED_INPUT
    ) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.assessmentStateInvalid,
        command.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    const github = parseGitHubRepositoryUrl(command.repositoryUrl);
    const gitlab = parseGitLabRepositoryUrl(command.repositoryUrl);
    const bitbucket = parseBitbucketRepositoryUrl(command.repositoryUrl);
    const azureDevOps = parseAzureDevOpsRepositoryUrl(command.repositoryUrl);
    const provider = github
      ? CREDENTIAL_PROVIDERS.github
      : gitlab
        ? CREDENTIAL_PROVIDERS.gitlab
        : bitbucket
          ? CREDENTIAL_PROVIDERS.bitbucket
          : azureDevOps
            ? CREDENTIAL_PROVIDERS.azureDevOps
            : null;
    const locator = github ?? gitlab ?? bitbucket ?? azureDevOps;
    if (!provider || !locator) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.credentialRequestInvalid,
        command.correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }
    let adapter: RepositoryProviderAdapter;
    try {
      adapter = this.providers.get(provider);
    } catch (error: unknown) {
      mapProviderFailure(error, command.correlationId);
    }
    let resolved: ResolvedActiveProviderCredential;
    try {
      resolved = await this.credentials.resolveActiveCredential({
        userId: command.userId,
        provider,
        repositoryFullName: locator.repositoryFullName,
      });
    } catch (error: unknown) {
      mapProviderFailure(error, command.correlationId);
    }
    const { metadata, lease } = resolved;
    try {
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
      const mode = toAuthMode(provider);
      const existing = await this.prisma.repositoryConnection.findFirst({
        where: {
          assessmentId: command.assessmentId,
          userId: command.userId,
          provider,
          repositoryId: repository.id,
          repositoryFullName: repository.fullName,
          authenticationMode: mode,
          credentialAuthorizationStatus:
            CREDENTIAL_AUTHORIZATION_STATUSES.active,
          status: RepositoryConnectionStatus.ACTIVE,
        },
        select: { id: true },
      });
      const now = new Date();
      if (existing) {
        await this.unitOfWork.execute(async (transaction) => {
          const currentCredential =
            await transaction.providerCredentials.findActiveByOwnerProvider(
              command.userId,
              provider,
            );
          if (
            !currentCredential ||
            currentCredential.id !== metadata.id ||
            currentCredential.currentVersion !== metadata.currentVersion ||
            currentCredential.status !== PROVIDER_CREDENTIAL_STATUSES.active
          ) {
            throw problemException(
              GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
              command.correlationId,
              { status: HttpStatus.UNAUTHORIZED },
            );
          }
          if (
            currentCredential.declaredExpiresAt !== null &&
            currentCredential.declaredExpiresAt <= now
          ) {
            throw problemException(
              GITHUB_CREDENTIAL_ERROR_CODES.credentialExpired,
              command.correlationId,
              { status: HttpStatus.UNAUTHORIZED },
            );
          }
          const updated =
            await transaction.database.repositoryConnection.updateMany({
              where: {
                id: existing.id,
                assessmentId: command.assessmentId,
                userId: command.userId,
                provider,
                repositoryId: repository.id,
                repositoryFullName: repository.fullName,
                authenticationMode: mode,
                status: RepositoryConnectionStatus.ACTIVE,
                credentialAuthorizationStatus:
                  CREDENTIAL_AUTHORIZATION_STATUSES.active,
              },
              data: {
                providerCredentialId: metadata.id,
                credentialVersion: metadata.currentVersion,
                credentialAuthorizedByUserId: command.userId,
                credentialAuthorizationStatus:
                  CREDENTIAL_AUTHORIZATION_STATUSES.active,
                credentialValidatedAt: now,
                credentialRevokedAt: null,
                defaultBranch: repository.defaultBranch,
              },
            });
          if (updated.count !== 1) {
            throw problemException(
              GITHUB_INTEGRATION_ERROR_CODES.connectionAlreadyExists,
              command.correlationId,
              { status: HttpStatus.CONFLICT },
            );
          }
        });
        return {
          connectionId: existing.id,
          provider,
          repositoryId: repository.id,
          repositoryFullName: repository.fullName,
          defaultBranch: repository.defaultBranch,
          status: REPOSITORY_CONNECTION_STATUSES.active,
        };
      }
      const connectionId = crypto.randomUUID();
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

function toAuthMode(
  provider: (typeof CREDENTIAL_PROVIDERS)[keyof typeof CREDENTIAL_PROVIDERS],
): RepositoryAuthenticationMode {
  switch (provider) {
    case CREDENTIAL_PROVIDERS.github:
      return RepositoryAuthenticationMode.GITHUB_CLI_CREDENTIAL;
    case CREDENTIAL_PROVIDERS.gitlab:
      return RepositoryAuthenticationMode.GITLAB_CLI_CREDENTIAL;
    case CREDENTIAL_PROVIDERS.bitbucket:
      return RepositoryAuthenticationMode.BITBUCKET_CLI_CREDENTIAL;
    case CREDENTIAL_PROVIDERS.azureDevOps:
      return RepositoryAuthenticationMode.AZURE_DEVOPS_CLI_CREDENTIAL;
  }
}
