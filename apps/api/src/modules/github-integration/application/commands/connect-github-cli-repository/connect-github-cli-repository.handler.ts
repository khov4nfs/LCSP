import { HttpStatus, Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  RepositoryAuthenticationMode,
  RepositoryConnectionStatus,
} from "@prisma/client";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  CREDENTIAL_AUTHORIZATION_STATUSES,
  CREDENTIAL_PROVIDERS,
  GITHUB_CREDENTIAL_ERROR_CODES,
  GITHUB_INTEGRATION_ERROR_CODES,
  GITHUB_INTEGRATION_EVENT_TYPES,
  PROVIDER_CREDENTIAL_STATUSES,
  REPOSITORY_CONNECTION_STATUSES,
  type CredentialProvider,
} from "@lcsp/contracts/github-integration";
import { toPrismaCredentialProvider } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";

import type { AppConfig } from "../../../../../config/config.types.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import type { GitHubCliRepositoryConnectionDto } from "../../contracts/github-integration/github-cli-connect.contract.js";
import {
  type GitHubIdentity,
  type GitHubRepositoryMetadata,
  type GitHubRepositoryProviderPort,
  REPOSITORY_PROVIDER_REGISTRY,
  type RepositoryProviderRegistry,
} from "../../ports/github-repository-provider.port.js";
import type { CredentialStorageContext } from "../../ports/security/credential-store.port.js";
import { CredentialLease } from "../../security/credential-lease.js";
import { PrismaCredentialPersistenceUnitOfWork } from "../../../infrastructure/persistence/prisma-credential-persistence.unit-of-work.js";
import {
  assertCredential,
  AZURE_DEVOPS_REPOSITORY_PATTERN,
  BITBUCKET_REPOSITORY_PATTERN,
  GITHUB_REPOSITORY_PATTERN,
  GITLAB_REPOSITORY_PATTERN,
  mapProviderFailure,
  parseAzureDevOpsRepositoryUrl,
  parseBitbucketRepositoryUrl,
  parseGitHubRepositoryUrl,
  parseGitLabRepositoryUrl,
} from "../github-cli-connect.support.js";
import { ConnectGitHubCliRepositoryCommand } from "./connect-github-cli-repository.command.js";

const INITIAL_CREDENTIAL_VERSION = 1;
const ENVELOPE_VERSION = 1;

@CommandHandler(ConnectGitHubCliRepositoryCommand)
export class ConnectGitHubCliRepositoryHandler implements ICommandHandler<ConnectGitHubCliRepositoryCommand> {
  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
    private readonly unitOfWork: PrismaCredentialPersistenceUnitOfWork,
    private readonly auditWriter: AuditWriterService,
    @Inject(REPOSITORY_PROVIDER_REGISTRY)
    private readonly providerRegistry: RepositoryProviderRegistry,
  ) {}

  /**
   * Business purpose: Validate and persist one customer's provider repository connection.
   * Business rules:
   * - This legacy credential-in-request endpoint accepts only GitHub and GitLab; Bitbucket and Azure credentials must use their typed, owner-scoped credential configuration.
   * - Only customer-owned operations using a registered provider adapter may validate or persist access, and numeric provider account IDs must remain exact.
   * - A provider cannot fall back to another provider's adapter or replace an external identity with a numeric hash.
   * Execution flow:
   * 1. Validate input and assessment ownership, reject new-provider use on this legacy endpoint, then select the exact provider adapter.
   * 2. Resolve identity and repository access, then persist encrypted credential metadata and the version-bound connection.
   * Failure cases:
   * - Invalid input, unsupported legacy credential shape, disabled provider, nonnumeric account ID, missing assessment, provider denial, or persistence conflict rejects without creating a connection.
   * Side effects:
   * - May call the selected provider, store encrypted credential material, persist the connection, and write an audit event; the lease is always disposed.
   */
  async execute(
    command: ConnectGitHubCliRepositoryCommand,
  ): Promise<GitHubCliRepositoryConnectionDto> {
    this.assertManager(command.subjectRole, command.correlationId);
    assertCredential(command.credential, command.correlationId);
    const provider = (command.provider ??
      CREDENTIAL_PROVIDERS.github) as CredentialProvider;
    if (!Object.values(CREDENTIAL_PROVIDERS).includes(provider)) {
      this.invalid(command.correlationId);
    }
    let providerAdapter: GitHubRepositoryProviderPort;
    try {
      providerAdapter = this.providerRegistry.get(provider);
    } catch (error: unknown) {
      mapProviderFailure(error, command.correlationId);
    }
    if (
      provider === CREDENTIAL_PROVIDERS.bitbucket ||
      provider === CREDENTIAL_PROVIDERS.azureDevOps
    ) {
      throw problemException(
        GITHUB_CREDENTIAL_ERROR_CODES.credentialRequired,
        command.correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }
    const repositoryFullName = parseRepositoryFullName(
      provider,
      command.repositoryUrl,
      command.repositoryFullName,
    );
    if (
      !repositoryFullName ||
      !isValidRepositoryPath(provider, repositoryFullName)
    ) {
      this.invalid(command.correlationId);
    }
    const declaredExpiresAt = this.parseExpiry(
      command.credentialExpiresAt,
      command.correlationId,
    );
    if (command.assessmentId) {
      const assessment = await this.prisma.assessment.findFirst({
        where: {
          id: command.assessmentId,
          ownerId: command.userId,
        },
        select: { id: true },
      });
      if (!assessment) this.invalid(command.correlationId);
    }

    const providerCredentialId = crypto.randomUUID();
    const lease = new CredentialLease(command.credential, {
      internalCredentialId: providerCredentialId,
      credentialVersion: INITIAL_CREDENTIAL_VERSION,
      repositoryFullName,
      expiresAt: new Date(
        Math.min(
          Date.now() + 2 * 60_000,
          declaredExpiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER,
        ),
      ),
    });
    try {
      const { identity, repository } = await this.validateProviderSource(
        providerAdapter,
        lease,
        repositoryFullName,
        command.correlationId,
        command.credential,
        providerCredentialId,
        command.repositoryUrl !== undefined,
      );
      if (!/^\d+$/u.test(identity.id)) {
        throw problemException(
          GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
          command.correlationId,
          { status: HttpStatus.BAD_GATEWAY },
        );
      }

      const authenticationMode = toRepositoryAuthenticationMode(provider);
      const duplicate = await this.prisma.repositoryConnection.findFirst({
        where: {
          userId: command.userId,
          repositoryId: repository.id,
          assessmentId: command.assessmentId ?? null,
          authenticationMode,
          status: RepositoryConnectionStatus.ACTIVE,
        },
        select: { id: true },
      });
      if (duplicate) {
        throw problemException(
          GITHUB_INTEGRATION_ERROR_CODES.connectionAlreadyExists,
          command.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }

      const connectionId = crypto.randomUUID();
      const validatedAt = new Date();
      const storageContext: CredentialStorageContext = {
        provider,
        providerCredentialId,
        ownerUserId: command.userId,
        credentialVersion: INITIAL_CREDENTIAL_VERSION,
        envelopeVersion: ENVELOPE_VERSION,
      };
      await this.unitOfWork.execute(async (transaction) => {
        await transaction.providerCredentials.create({
          id: providerCredentialId,
          provider,
          ownerUserId: command.userId,
          providerAccountId: BigInt(identity.id),
          providerAccountExternalId: null,
          providerLogin: identity.login,
          status: PROVIDER_CREDENTIAL_STATUSES.active,
          currentVersion: INITIAL_CREDENTIAL_VERSION,
          declaredExpiresAt,
          validatedAt,
        });
        await transaction.credentialStore.store(
          command.credential,
          storageContext,
        );
        await transaction.database.repositoryConnection.create({
          data: {
            id: connectionId,
            assessmentId: command.assessmentId ?? null,
            userId: command.userId,
            provider: toPrismaCredentialProvider(provider),
            installationId: null,
            authenticationMode,
            providerCredentialId,
            credentialVersion: INITIAL_CREDENTIAL_VERSION,
            credentialAuthorizedByUserId: command.userId,
            credentialAuthorizationStatus:
              CREDENTIAL_AUTHORIZATION_STATUSES.active,
            credentialValidatedAt: validatedAt,
            credentialRevokedAt: null,
            repositoryId: repository.id,
            repositoryName: repository.name,
            repositoryFullName: repository.fullName,
            defaultBranch: repository.defaultBranch,
            permissions: {},
            status: RepositoryConnectionStatus.ACTIVE,
            connectedAt: validatedAt,
          },
        });
      });
      await this.auditWriter.write({
        eventType: GITHUB_INTEGRATION_EVENT_TYPES.cliRepositoryConnected,
        actorId: command.userId,
        assessmentId: command.assessmentId ?? null,
        resourceType: AUDIT_RESOURCE_TYPES.repositoryConnection,
        resourceId: connectionId,
        correlationId: command.correlationId,
        sessionId: command.sessionId,
        decision: AUDIT_DECISIONS.allow,
        payload: {
          repositoryId: repository.id,
          repositoryFullName: repository.fullName,
          providerAccountId: identity.id,
          providerLogin: identity.login,
        },
      });

      return {
        connection_id: connectionId,
        repository: {
          repository_id: repository.id,
          name: repository.name,
          full_name: repository.fullName,
          default_branch: repository.defaultBranch,
          private: repository.private,
        },
        authenticated_account: { id: identity.id, login: identity.login },
        connection_status: REPOSITORY_CONNECTION_STATUSES.active,
        credential_status: PROVIDER_CREDENTIAL_STATUSES.active,
        declared_expires_at: declaredExpiresAt?.toISOString() ?? null,
        connected_at: validatedAt.toISOString(),
      };
    } finally {
      lease.dispose();
    }
  }

  private assertManager(role: string, correlationId: string): void {
    if (role !== AUTH_USER_ROLES.customer) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.connectionNotFound,
        correlationId,
        { status: HttpStatus.FORBIDDEN },
      );
    }
  }

  private async validateProviderSource(
    provider: GitHubRepositoryProviderPort,
    lease: CredentialLease,
    repositoryFullName: string,
    correlationId: string,
    credential: string,
    providerCredentialId: string,
    allowCanonicalRename: boolean,
  ): Promise<{
    identity: GitHubIdentity;
    repository: GitHubRepositoryMetadata;
  }> {
    try {
      const identity = await provider.validateIdentity(lease);
      const repository = await provider.validateRepositoryAccess(
        lease,
        repositoryFullName,
        allowCanonicalRename,
      );
      if (!repository.defaultBranch) {
        this.invalid(correlationId);
      }
      const resolutionLease =
        repository.fullName === repositoryFullName
          ? lease
          : new CredentialLease(credential, {
              internalCredentialId: providerCredentialId,
              credentialVersion: lease.credentialVersion,
              repositoryFullName: repository.fullName,
              expiresAt: lease.expiresAt,
            });
      try {
        await provider.resolveCommit(
          resolutionLease,
          repository.fullName,
          repository.defaultBranch,
        );
      } finally {
        if (resolutionLease !== lease) resolutionLease.dispose();
      }
      return { identity, repository };
    } catch (error: unknown) {
      mapProviderFailure(error, correlationId);
    }
  }

  private parseExpiry(
    value: string | undefined,
    correlationId: string,
  ): Date | null {
    if (value === undefined) return null;
    const parsed = new Date(value);
    if (
      !/^\d{4}-\d{2}-\d{2}T/u.test(value) ||
      !Number.isFinite(parsed.getTime()) ||
      parsed.getTime() <= Date.now()
    ) {
      this.invalid(correlationId);
    }
    return parsed;
  }

  private invalid(correlationId: string): never {
    throw problemException(
      GITHUB_INTEGRATION_ERROR_CODES.credentialRequestInvalid,
      correlationId,
      { status: HttpStatus.BAD_REQUEST },
    );
  }
}

function parseRepositoryFullName(
  provider: (typeof CREDENTIAL_PROVIDERS)[keyof typeof CREDENTIAL_PROVIDERS],
  repositoryUrl?: string,
  repositoryFullName?: string,
): string | undefined {
  if (repositoryUrl !== undefined) {
    switch (provider) {
      case CREDENTIAL_PROVIDERS.github:
        return parseGitHubRepositoryUrl(repositoryUrl)?.repositoryFullName;
      case CREDENTIAL_PROVIDERS.gitlab:
        return parseGitLabRepositoryUrl(repositoryUrl)?.repositoryFullName;
      case CREDENTIAL_PROVIDERS.bitbucket:
        return parseBitbucketRepositoryUrl(repositoryUrl)?.repositoryFullName;
      case CREDENTIAL_PROVIDERS.azureDevOps:
        return parseAzureDevOpsRepositoryUrl(repositoryUrl)?.repositoryFullName;
    }
  }
  return repositoryFullName?.trim();
}

function isValidRepositoryPath(
  provider: (typeof CREDENTIAL_PROVIDERS)[keyof typeof CREDENTIAL_PROVIDERS],
  path: string,
): boolean {
  switch (provider) {
    case CREDENTIAL_PROVIDERS.github:
      return GITHUB_REPOSITORY_PATTERN.test(path);
    case CREDENTIAL_PROVIDERS.gitlab:
      return GITLAB_REPOSITORY_PATTERN.test(path);
    case CREDENTIAL_PROVIDERS.bitbucket:
      return BITBUCKET_REPOSITORY_PATTERN.test(path);
    case CREDENTIAL_PROVIDERS.azureDevOps:
      return AZURE_DEVOPS_REPOSITORY_PATTERN.test(path);
  }
}

function toRepositoryAuthenticationMode(
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
