import { createHash, timingSafeEqual } from "node:crypto";
import { HttpStatus, Inject, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  CREDENTIAL_PROVIDERS,
  GITHUB_CREDENTIAL_ERROR_CODES,
  GITHUB_INTEGRATION_ERROR_CODES,
  PROVIDER_CREDENTIAL_STATUSES,
  type CredentialProvider,
} from "@lcsp/contracts/github-integration";

import type { AppConfig } from "../../../../../config/config.types.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
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

  /**
   * Business purpose: Connect a customer's provider account or replace its PAT.
   * Business rules:
   * - Settings may change only the authenticated owner's provider.
   * - A repeated PAT retains its declared expiry; a different PAT has unknown expiry.
   * Execution flow:
   * 1. Validate the submitted PAT with its provider.
   * 2. Resolve expiry and store metadata and the encrypted PAT in one versioned transaction.
   * 3. Acknowledge the connected provider with public account metadata.
   * Failure cases:
   * - Invalid, already-expired or concurrently replaced credentials do not commit.
   * Side effects:
   * - Creates or rotates an encrypted credential without returning the PAT.
   */
  async execute(command: ConfigureProviderCredentialCommand) {
    if (command.subjectRole !== AUTH_USER_ROLES.customer) {
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
      let expired = false;
      try {
        expired = await this.unitOfWork.execute(async (transaction) => {
          if (existing) {
            // Expiry belongs to the secret. Compare only an owned credential with a known
            // expiry, then require the original version when committing the replacement.
            let declaredExpiresAt = existing.declaredExpiresAt;
            if (declaredExpiresAt !== null) {
              const previousCredential = await transaction.credentialStore.read(
                existing.id as CredentialLocator,
              );
              const sameCredential = timingSafeEqual(
                credentialExpiryDigest(context.provider, previousCredential),
                credentialExpiryDigest(context.provider, command.credential),
              );
              if (!sameCredential) declaredExpiresAt = null;
              else if (declaredExpiresAt <= validatedAt) return true;
            }
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
                  declaredExpiresAt,
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
          return false;
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
      if (expired) {
        throw problemException(
          GITHUB_CREDENTIAL_ERROR_CODES.credentialExpired,
          command.correlationId,
          { status: HttpStatus.UNAUTHORIZED },
        );
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

/**
 * Business purpose: Compare the effective PAT when deciding whether its existing expiry still applies.
 * Business rules:
 * - Azure's optional organization hint does not change the underlying PAT.
 * Execution flow:
 * 1. Extract the effective secret and hash it for a fixed-length comparison.
 * Failure cases:
 * - An empty Azure suffix uses the original input, matching provider validation.
 * Side effects:
 * - Returns a transient digest without logging or persisting credential material.
 */
function credentialExpiryDigest(
  provider: CredentialProvider,
  credential: string,
): Buffer {
  // Azure accepts organization:PAT; only the suffix is used for authentication.
  const delimiter = credential.indexOf(":");
  const secret =
    provider === CREDENTIAL_PROVIDERS.azureDevOps
      ? credential.slice(delimiter + 1).trim() || credential
      : credential;
  return createHash("sha256").update(secret).digest();
}

function toProviderAccountIdBigInt(id: string): bigint {
  if (/^\d+$/u.test(id)) return BigInt(id);
  const hash = createHash("sha256").update(id).digest();
  return hash.readBigUInt64BE(0) & 0x7fffffffffffffffn;
}
