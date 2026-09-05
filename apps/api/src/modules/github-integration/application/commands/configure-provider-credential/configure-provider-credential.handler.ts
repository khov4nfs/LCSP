import { createHash } from "node:crypto";
import { HttpStatus, Inject, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  CREDENTIAL_PROVIDERS,
  GITHUB_INTEGRATION_ERROR_CODES,
  PROVIDER_CREDENTIAL_STATUSES,
  type CredentialProvider,
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
      !Object.values(CREDENTIAL_PROVIDERS).includes(
        command.provider as (typeof CREDENTIAL_PROVIDERS)[keyof typeof CREDENTIAL_PROVIDERS],
      )
    ) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.credentialRequestInvalid,
        command.correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }
    const providerKey = command.provider as CredentialProvider;
    const provider = this.registry.get(providerKey) ?? this.fallbackProvider;
    const { existing, user } = await this.unitOfWork.execute(
      async (transaction) => {
        const existingCred =
          await transaction.providerCredentials.findActiveByOwnerProvider(
            command.userId,
            providerKey,
          );
        const userRecord = await transaction.database.user.findUnique({
          where: { id: command.userId },
          select: { email: true },
        });
        return { existing: existingCred, user: userRecord };
      },
    );
    const credentialId = existing?.id ?? crypto.randomUUID();
    const credentialVersion = existing ? existing.currentVersion + 1 : 1;
    const lease = new CredentialLease(command.credential, {
      internalCredentialId: credentialId,
      credentialVersion,
      repositoryFullName: user?.email ?? "provider-account",
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
        provider: providerKey,
        providerCredentialId: credentialId,
        ownerUserId: command.userId,
        credentialVersion,
        envelopeVersion: ENVELOPE_VERSION,
      };
      const validatedAt = new Date();
      const providerAccountId = toProviderAccountIdBigInt(identity.id);
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
                  providerAccountId,
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
              providerAccountId,
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

function toProviderAccountIdBigInt(id: string): bigint {
  if (/^\d+$/u.test(id)) return BigInt(id);
  const hash = createHash("sha256").update(id).digest();
  return hash.readBigUInt64BE(0) & 0x7fffffffffffffffn;
}
