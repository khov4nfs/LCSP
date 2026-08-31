import { HttpStatus, Inject, Optional } from "@nestjs/common";
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
  GITHUB_INTEGRATION_ERROR_CODES,
  GITHUB_INTEGRATION_EVENT_TYPES,
  PROVIDER_CREDENTIAL_STATUSES,
  REPOSITORY_CONNECTION_STATUSES,
} from "@lcsp/contracts/github-integration";

import type { AppConfig } from "../../../../../config/config.types.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import type { GitHubCliRepositoryConnectionDto } from "../../contracts/github-integration/github-cli-connect.contract.js";
import {
  GITHUB_REPOSITORY_PROVIDER,
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
  GITHUB_REPOSITORY_PATTERN,
  GITLAB_REPOSITORY_PATTERN,
  mapProviderFailure,
  parseGitHubRepositoryUrl,
  parseGitLabRepositoryUrl,
} from "../github-cli-connect.support.js";
import { ConnectGitHubCliRepositoryCommand } from "./connect-github-cli-repository.command.js";

const INITIAL_CREDENTIAL_VERSION = 1;
const ENVELOPE_VERSION = 1;

@CommandHandler(ConnectGitHubCliRepositoryCommand)
export class ConnectGitHubCliRepositoryHandler implements ICommandHandler<ConnectGitHubCliRepositoryCommand> {
  constructor(
    @Inject(GITHUB_REPOSITORY_PROVIDER)
    private readonly provider: GitHubRepositoryProviderPort,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
    private readonly unitOfWork: PrismaCredentialPersistenceUnitOfWork,
    private readonly auditWriter: AuditWriterService,
    @Optional()
    @Inject(REPOSITORY_PROVIDER_REGISTRY)
    private readonly providerRegistry?: RepositoryProviderRegistry,
  ) {}

  async execute(
    command: ConnectGitHubCliRepositoryCommand,
  ): Promise<GitHubCliRepositoryConnectionDto> {
    this.assertEnabledAndManager(command.subjectRole, command.correlationId);
    assertCredential(command.credential, command.correlationId);
    const provider = command.provider ?? CREDENTIAL_PROVIDERS.github;
    if (
      provider !== CREDENTIAL_PROVIDERS.github &&
      provider !== CREDENTIAL_PROVIDERS.gitlab
    ) {
      this.invalid(command.correlationId);
    }
    const providerAdapter =
      this.providerRegistry?.get(provider) ?? this.provider;
    const repositoryFullName =
      command.repositoryUrl !== undefined
        ? provider === CREDENTIAL_PROVIDERS.github
          ? parseGitHubRepositoryUrl(command.repositoryUrl)?.repositoryFullName
          : parseGitLabRepositoryUrl(command.repositoryUrl)?.repositoryFullName
        : command.repositoryFullName?.trim();
    if (
      !repositoryFullName ||
      !(provider === CREDENTIAL_PROVIDERS.github
        ? GITHUB_REPOSITORY_PATTERN.test(repositoryFullName)
        : GITLAB_REPOSITORY_PATTERN.test(repositoryFullName))
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

      const duplicate = await this.prisma.repositoryConnection.findFirst({
        where: {
          userId: command.userId,
          repositoryId: repository.id,
          assessmentId: command.assessmentId ?? null,
          authenticationMode:
            provider === CREDENTIAL_PROVIDERS.github
              ? RepositoryAuthenticationMode.GITHUB_CLI_CREDENTIAL
              : RepositoryAuthenticationMode.GITLAB_CLI_CREDENTIAL,
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
            provider,
            installationId: null,
            authenticationMode:
              provider === CREDENTIAL_PROVIDERS.github
                ? RepositoryAuthenticationMode.GITHUB_CLI_CREDENTIAL
                : RepositoryAuthenticationMode.GITLAB_CLI_CREDENTIAL,
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

  private assertEnabledAndManager(role: string, correlationId: string): void {
    if (
      !this.config.get("githubCredentialPersistence", { infer: true }).enabled
    ) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.cliConnectDisabled,
        correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
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
