import { Inject, Injectable } from "@nestjs/common";
import { CredentialProvider, ProviderCredentialStatus } from "@prisma/client";
import {
  CREDENTIAL_PROVIDERS,
  PROVIDER_CREDENTIAL_STATUSES,
  type ProviderCredentialStatus as ContractCredentialStatus,
} from "@lcsp/contracts/github-integration";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type {
  ActiveProviderCredentialMetadata,
  ActiveProviderCredentialResolver,
  ProviderCredentialLifecycleMetadata,
  ResolvedActiveProviderCredential,
} from "../../application/ports/security/active-provider-credential.resolver.js";
import {
  CREDENTIAL_STORE,
  type CredentialStorePort,
  type CredentialLocator,
} from "../../application/ports/security/credential-store.port.js";
import { CredentialLease } from "../../application/security/credential-lease.js";
import { CredentialResolutionError } from "./prisma-credential-authorization.resolver.js";
import { GITHUB_CREDENTIAL_ERROR_CODES } from "@lcsp/contracts/github-integration";

@Injectable()
export class PrismaActiveProviderCredentialResolver implements ActiveProviderCredentialResolver {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CREDENTIAL_STORE) private readonly store: CredentialStorePort,
  ) {}

  /**
   * Business purpose: Lease the owner's active provider credential for validating one repository connection.
   * Business rules: Only an active credential owned by the caller and matching the requested provider can be leased; missing credentials are reported as required, while unusable stored material is invalid.
   * Execution flow: Load the active provider row, validate its exact persisted account identity, read encrypted material, and bind the lease to the requested repository and credential version.
   * Failure cases: Missing credentials raise credentialRequired; missing ciphertext or malformed identity raises credentialInvalid; storage failures do not produce a lease.
   * Side effects: Reads persistence and encrypted credential material and returns an in-memory disposable lease; no provider request is made.
   */
  async resolveActiveCredential(input: {
    userId: string;
    provider: CredentialProvider;
    repositoryFullName: string;
  }): Promise<ResolvedActiveProviderCredential> {
    const row = await this.prisma.providerCredential.findFirst({
      where: {
        ownerUserId: input.userId,
        provider: input.provider,
        status: ProviderCredentialStatus.ACTIVE,
        isActive: true,
      },
      orderBy: [{ validatedAt: "desc" }, { id: "desc" }],
    });
    if (!row) {
      throw new CredentialResolutionError(
        GITHUB_CREDENTIAL_ERROR_CODES.credentialRequired,
      );
    }
    if (!row.ciphertext) {
      throw new CredentialResolutionError(
        GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
      );
    }
    const metadata: ActiveProviderCredentialMetadata = {
      id: row.id,
      provider: fromPrismaProvider(row.provider),
      providerAccountId: projectAccountIdentity(
        row.provider,
        row.providerAccountId,
        row.providerAccountExternalId,
      ),
      providerLogin: row.providerLogin,
      currentVersion: row.currentVersion,
    };
    const secret = await this.store.read(row.id as CredentialLocator);
    return {
      metadata,
      lease: new CredentialLease(secret, {
        internalCredentialId: row.id,
        credentialVersion: row.currentVersion,
        repositoryFullName: input.repositoryFullName,
        expiresAt: new Date(Date.now() + 5 * 60_000),
      }),
    };
  }

  async findMetadata(input: {
    userId: string;
    provider: CredentialProvider;
  }): Promise<ActiveProviderCredentialMetadata | null> {
    const row = await this.prisma.providerCredential.findFirst({
      where: {
        ownerUserId: input.userId,
        provider: input.provider,
        status: ProviderCredentialStatus.ACTIVE,
        isActive: true,
      },
      orderBy: [{ validatedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        provider: true,
        providerAccountId: true,
        providerAccountExternalId: true,
        providerLogin: true,
        currentVersion: true,
      },
    });
    return row
      ? {
          id: row.id,
          provider: fromPrismaProvider(row.provider),
          providerAccountId: projectAccountIdentity(
            row.provider,
            row.providerAccountId,
            row.providerAccountExternalId,
          ),
          providerLogin: row.providerLogin,
          currentVersion: row.currentVersion,
        }
      : null;
  }

  async findLifecycle(input: {
    userId: string;
    provider: CredentialProvider;
  }): Promise<ProviderCredentialLifecycleMetadata | null> {
    const row = await this.prisma.providerCredential.findFirst({
      where: {
        ownerUserId: input.userId,
        provider: input.provider,
        isActive: true,
      },
      orderBy: [{ validatedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        provider: true,
        providerAccountId: true,
        providerAccountExternalId: true,
        providerLogin: true,
        currentVersion: true,
        status: true,
        declaredExpiresAt: true,
      },
    });
    if (!row) return null;
    const expired =
      row.declaredExpiresAt !== null && row.declaredExpiresAt <= new Date();
    return {
      id: row.id,
      provider: fromPrismaProvider(row.provider),
      providerAccountId: projectAccountIdentity(
        row.provider,
        row.providerAccountId,
        row.providerAccountExternalId,
      ),
      providerLogin: row.providerLogin,
      currentVersion: row.currentVersion,
      status:
        expired && row.status === ProviderCredentialStatus.ACTIVE
          ? PROVIDER_CREDENTIAL_STATUSES.expired
          : fromPrismaStatus(row.status),
    };
  }

  async resolveLease(input: {
    userId: string;
    provider: CredentialProvider;
    repositoryFullName: string;
  }): Promise<CredentialLease> {
    return (await this.resolveActiveCredential(input)).lease;
  }
}

/**
 * Business purpose: Project a verified provider identity into the existing string response field.
 * Business rules: GitHub/GitLab retain numeric identity; Bitbucket/Azure require exact external identity and cannot fall back to a numeric hash.
 * Execution flow: Validate the provider-specific persisted pair, then return its canonical stored representation.
 * Failure cases: Missing, mixed, or contradictory identity columns raise credentialInvalid.
 * Side effects: Pure validation and projection.
 */
function projectAccountIdentity(
  provider: CredentialProvider,
  numericId: bigint | null,
  externalId: string | null,
): string {
  if (
    provider === CredentialProvider.BITBUCKET ||
    provider === CredentialProvider.AZURE_DEVOPS
  ) {
    if (
      numericId !== null ||
      !externalId ||
      externalId.trim() !== externalId ||
      (provider === CredentialProvider.BITBUCKET &&
        !/^(?:\{[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/iu.test(
          externalId,
        )) ||
      (provider === CredentialProvider.AZURE_DEVOPS &&
        !/^azure-organization:[a-z0-9][a-z0-9-]{0,63}$/iu.test(externalId))
    ) {
      throw new CredentialResolutionError(
        GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
      );
    }
    return externalId;
  }
  if (numericId === null || externalId !== null) {
    throw new CredentialResolutionError(
      GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
    );
  }
  return numericId.toString();
}

function fromPrismaProvider(
  provider: CredentialProvider,
): (typeof CREDENTIAL_PROVIDERS)[keyof typeof CREDENTIAL_PROVIDERS] {
  switch (provider) {
    case CredentialProvider.GITLAB:
      return CREDENTIAL_PROVIDERS.gitlab;
    case CredentialProvider.BITBUCKET:
      return CREDENTIAL_PROVIDERS.bitbucket;
    case CredentialProvider.AZURE_DEVOPS:
      return CREDENTIAL_PROVIDERS.azureDevOps;
    default:
      return CREDENTIAL_PROVIDERS.github;
  }
}

function fromPrismaStatus(
  status: ProviderCredentialStatus,
): ContractCredentialStatus {
  const values: Record<ProviderCredentialStatus, ContractCredentialStatus> = {
    [ProviderCredentialStatus.PENDING]: PROVIDER_CREDENTIAL_STATUSES.pending,
    [ProviderCredentialStatus.ACTIVE]: PROVIDER_CREDENTIAL_STATUSES.active,
    [ProviderCredentialStatus.INVALID]: PROVIDER_CREDENTIAL_STATUSES.invalid,
    [ProviderCredentialStatus.EXPIRED]: PROVIDER_CREDENTIAL_STATUSES.expired,
    [ProviderCredentialStatus.REVOKING]: PROVIDER_CREDENTIAL_STATUSES.revoking,
    [ProviderCredentialStatus.REVOKED]: PROVIDER_CREDENTIAL_STATUSES.revoked,
    [ProviderCredentialStatus.STORAGE_ERROR]:
      PROVIDER_CREDENTIAL_STATUSES.storageError,
  };
  return values[status];
}
