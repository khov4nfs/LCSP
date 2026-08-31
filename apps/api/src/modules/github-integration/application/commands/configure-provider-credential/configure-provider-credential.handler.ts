import { HttpStatus, Inject, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  CREDENTIAL_PROVIDERS,
  GITHUB_INTEGRATION_ERROR_CODES,
  PROVIDER_CREDENTIAL_STATUSES,
} from "@lcsp/contracts/github-integration";

import type { AppConfig } from "../../../../../config/config.types.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { PrismaCredentialPersistenceUnitOfWork } from "../../../infrastructure/persistence/prisma-credential-persistence.unit-of-work.js";
import {
  GITHUB_REPOSITORY_PROVIDER,
  REPOSITORY_PROVIDER_REGISTRY,
  type GitHubIdentity,
  type GitHubRepositoryProviderPort,
  type RepositoryProviderRegistry,
} from "../../ports/github-repository-provider.port.js";
import type {
  CredentialLocator,
  CredentialStorageContext,
} from "../../ports/security/credential-store.port.js";
import { CredentialLease } from "../../security/credential-lease.js";
import {
  assertCredential,
  mapProviderFailure,
} from "../github-cli-connect.support.js";
import { ConfigureProviderCredentialCommand } from "./configure-provider-credential.command.js";

const ENVELOPE_VERSION = 1;

@CommandHandler(ConfigureProviderCredentialCommand)
export class ConfigureProviderCredentialHandler implements ICommandHandler<ConfigureProviderCredentialCommand> {
  private readonly logger = new Logger(ConfigureProviderCredentialHandler.name);
  constructor(
    @Inject(GITHUB_REPOSITORY_PROVIDER)
    private readonly fallbackProvider: GitHubRepositoryProviderPort,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly unitOfWork: PrismaCredentialPersistenceUnitOfWork,
    @Inject(REPOSITORY_PROVIDER_REGISTRY)
    private readonly registry: RepositoryProviderRegistry,
  ) {}

  async execute(command: ConfigureProviderCredentialCommand) {
    if (
      command.subjectRole !== AUTH_USER_ROLES.customer ||
      !this.config.get("githubCredentialPersistence", { infer: true }).enabled
    ) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.cliConnectDisabled,
        command.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    assertCredential(command.credential, command.correlationId);
    if (
      command.provider !== CREDENTIAL_PROVIDERS.github &&
      command.provider !== CREDENTIAL_PROVIDERS.gitlab
    ) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.credentialRequestInvalid,
        command.correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }
    const provider =
      this.registry.get(command.provider) ?? this.fallbackProvider;
    const existing = await this.unitOfWork.execute((transaction) =>
      transaction.providerCredentials.findActiveByOwnerProvider(
        command.userId,
        command.provider as CredentialStorageContext["provider"],
      ),
    );
    const credentialId = existing?.id ?? crypto.randomUUID();
    const credentialVersion = existing ? existing.currentVersion + 1 : 1;
    const lease = new CredentialLease(command.credential, {
      internalCredentialId: credentialId,
      credentialVersion,
      repositoryFullName: "provider-account",
      expiresAt: new Date(Date.now() + 2 * 60_000),
    });
    try {
      let identity: GitHubIdentity;
      try {
        identity = await provider.validateIdentity(lease);
      } catch (error: unknown) {
        mapProviderFailure(error, command.correlationId);
      }
      const context: CredentialStorageContext = {
        provider: command.provider,
        providerCredentialId: credentialId,
        ownerUserId: command.userId,
        credentialVersion,
        envelopeVersion: ENVELOPE_VERSION,
      };
      const validatedAt = new Date();
      try {
        await this.unitOfWork.execute(async (transaction) => {
          if (existing) {
            const updated =
              await transaction.providerCredentials.updateForRotation(
                existing.id,
                command.userId,
                existing.currentVersion,
                {
                  ...existing,
                  provider: context.provider,
                  providerAccountId: BigInt(identity.id),
                  providerLogin: identity.login,
                  status: PROVIDER_CREDENTIAL_STATUSES.active,
                  currentVersion: credentialVersion,
                  validatedAt,
                },
              );
            if (!updated)
              throw new Error("provider_credential_version_conflict");
            await transaction.credentialStore.replace(
              existing.id as CredentialLocator,
              command.credential,
              context,
            );
          } else {
            await transaction.providerCredentials.create({
              id: credentialId,
              provider: context.provider,
              ownerUserId: command.userId,
              providerAccountId: BigInt(identity.id),
              providerLogin: identity.login,
              status: PROVIDER_CREDENTIAL_STATUSES.active,
              currentVersion: credentialVersion,
              declaredExpiresAt: null,
              validatedAt,
            });
            await transaction.credentialStore.store(
              command.credential,
              context,
            );
          }
        });
      } catch (error: unknown) {
        this.logger.error(
          JSON.stringify({
            event: "provider_credential_persistence_failed",
            correlationId: command.correlationId,
            userIdPresent: command.userId.length > 0,
            provider: command.provider,
            credentialIdPresent: credentialId.length > 0,
            credentialVersion,
            errorClass:
              error instanceof Error ? error.constructor.name : "Unknown",
            errorCode:
              typeof error === "object" && error !== null && "code" in error
                ? String((error as { code?: unknown }).code)
                : undefined,
          }),
        );
        throw error;
      }
      return {
        provider: command.provider,
        configured: true,
        account: { id: identity.id, username: identity.login },
      };
    } finally {
      lease.dispose();
    }
  }
}
