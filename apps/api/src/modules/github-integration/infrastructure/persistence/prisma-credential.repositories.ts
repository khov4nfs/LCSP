import { Injectable, Optional } from "@nestjs/common";
import {
  CredentialProvider as PrismaCredentialProvider,
  ProviderCredentialStatus as PrismaCredentialStatus,
  Prisma,
} from "@prisma/client";
import {
  CREDENTIAL_PROVIDERS,
  PROVIDER_CREDENTIAL_STATUSES,
  type CredentialProvider,
  type ProviderCredentialStatus,
} from "@lcsp/contracts/github-integration";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type {
  ProviderCredentialRecord,
  ProviderCredentialRepository,
} from "../../application/ports/persistence/provider-credential.repository.js";

@Injectable()
export class PrismaProviderCredentialRepository implements ProviderCredentialRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly client: Prisma.TransactionClient = prisma,
  ) {}

  withTransaction(
    transaction: Prisma.TransactionClient,
  ): PrismaProviderCredentialRepository {
    return new PrismaProviderCredentialRepository(this.prisma, transaction);
  }

  async create(record: ProviderCredentialRecord): Promise<void> {
    await this.client.providerCredential.create({
      data: {
        ...record,
        provider: toPrismaCredentialProvider(record.provider),
        status: toCredentialStatus(record.status),
        isActive: true,
      },
    });
  }

  async findActiveByOwnerProvider(
    ownerUserId: string,
    provider: CredentialProvider,
  ): Promise<ProviderCredentialRecord | null> {
    const row = await this.client.providerCredential.findFirst({
      where: {
        ownerUserId,
        provider: toPrismaCredentialProvider(provider),
        isActive: true,
      },
      orderBy: [{ validatedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        provider: true,
        ownerUserId: true,
        providerAccountId: true,
        providerLogin: true,
        status: true,
        currentVersion: true,
        declaredExpiresAt: true,
        validatedAt: true,
      },
    });
    return row ? toRecord(row) : null;
  }

  async updateForRotation(
    id: string,
    ownerUserId: string,
    expectedVersion: number,
    record: Omit<ProviderCredentialRecord, "id" | "currentVersion"> & {
      currentVersion: number;
    },
  ): Promise<boolean> {
    const result = await this.client.providerCredential.updateMany({
      where: { id, ownerUserId, currentVersion: expectedVersion },
      data: {
        providerAccountId: record.providerAccountId,
        providerLogin: record.providerLogin,
        status: toCredentialStatus(record.status),
        currentVersion: record.currentVersion,
        isActive: true,
        validatedAt: record.validatedAt,
        invalidatedAt: null,
        lastFailureCode: null,
      },
    });
    return result.count === 1;
  }

  async deactivateActive(
    ownerUserId: string,
    provider: CredentialProvider,
  ): Promise<void> {
    await this.client.providerCredential.updateMany({
      where: {
        ownerUserId,
        provider: toPrismaCredentialProvider(provider),
        isActive: true,
      },
      data: { isActive: false },
    });
  }

  async findByIdForOwner(
    id: string,
    ownerUserId: string,
  ): Promise<ProviderCredentialRecord | null> {
    const row = await this.client.providerCredential.findFirst({
      where: { id, ownerUserId },
      select: {
        id: true,
        provider: true,
        ownerUserId: true,
        providerAccountId: true,
        providerLogin: true,
        status: true,
        currentVersion: true,
        declaredExpiresAt: true,
        validatedAt: true,
      },
    });
    return row
      ? {
          id: row.id,
          provider: fromPrismaCredentialProvider(row.provider),
          ownerUserId: row.ownerUserId,
          providerAccountId: row.providerAccountId,
          providerLogin: row.providerLogin,
          status: fromCredentialStatus(row.status),
          currentVersion: row.currentVersion,
          declaredExpiresAt: row.declaredExpiresAt,
          validatedAt: row.validatedAt,
        }
      : null;
  }

  async updateLifecycle(
    id: string,
    ownerUserId: string,
    status: ProviderCredentialStatus,
    safeFailureCode?: string,
  ): Promise<boolean> {
    const now = new Date();
    const result = await this.client.providerCredential.updateMany({
      where: { id, ownerUserId },
      data: {
        status: toCredentialStatus(status),
        lastFailureCode: safeFailureCode,
        invalidatedAt:
          status === PROVIDER_CREDENTIAL_STATUSES.invalid ? now : undefined,
        revocationRequestedAt:
          status === PROVIDER_CREDENTIAL_STATUSES.revoking ? now : undefined,
        revokedAt:
          status === PROVIDER_CREDENTIAL_STATUSES.revoked ? now : undefined,
      },
    });
    return result.count === 1;
  }

  async updateVersion(
    id: string,
    ownerUserId: string,
    expectedVersion: number,
    newVersion: number,
  ): Promise<boolean> {
    const result = await this.client.providerCredential.updateMany({
      where: { id, ownerUserId, currentVersion: expectedVersion },
      data: { currentVersion: newVersion },
    });
    return result.count === 1;
  }

  async markValidated(
    id: string,
    ownerUserId: string,
    at: Date,
  ): Promise<boolean> {
    return (
      (
        await this.client.providerCredential.updateMany({
          where: { id, ownerUserId },
          data: { validatedAt: at },
        })
      ).count === 1
    );
  }

  async markUsed(
    id: string,
    ownerUserId: string,
    version: number,
    at: Date,
  ): Promise<boolean> {
    return (
      (
        await this.client.providerCredential.updateMany({
          where: { id, ownerUserId, currentVersion: version },
          data: { lastUsedAt: at },
        })
      ).count === 1
    );
  }
}

function toRecord(row: {
  id: string;
  provider: PrismaCredentialProvider;
  ownerUserId: string;
  providerAccountId: bigint;
  providerLogin: string;
  status: PrismaCredentialStatus;
  currentVersion: number;
  declaredExpiresAt: Date | null;
  validatedAt: Date | null;
}): ProviderCredentialRecord {
  return {
    id: row.id,
    provider: fromPrismaCredentialProvider(row.provider),
    ownerUserId: row.ownerUserId,
    providerAccountId: row.providerAccountId,
    providerLogin: row.providerLogin,
    status: fromCredentialStatus(row.status),
    currentVersion: row.currentVersion,
    declaredExpiresAt: row.declaredExpiresAt,
    validatedAt: row.validatedAt,
  };
}

function fromPrismaCredentialProvider(
  provider: PrismaCredentialProvider,
): CredentialProvider {
  switch (provider) {
    case PrismaCredentialProvider.GITLAB:
      return CREDENTIAL_PROVIDERS.gitlab;
    case PrismaCredentialProvider.BITBUCKET:
      return CREDENTIAL_PROVIDERS.bitbucket;
    case PrismaCredentialProvider.AZURE_DEVOPS:
      return CREDENTIAL_PROVIDERS.azureDevOps;
    default:
      return CREDENTIAL_PROVIDERS.github;
  }
}

function toPrismaCredentialProvider(
  provider: CredentialProvider,
): PrismaCredentialProvider {
  switch (provider) {
    case CREDENTIAL_PROVIDERS.gitlab:
      return PrismaCredentialProvider.GITLAB;
    case CREDENTIAL_PROVIDERS.bitbucket:
      return PrismaCredentialProvider.BITBUCKET;
    case CREDENTIAL_PROVIDERS.azureDevOps:
      return PrismaCredentialProvider.AZURE_DEVOPS;
    default:
      return PrismaCredentialProvider.GITHUB;
  }
}

function toCredentialStatus(
  status: ProviderCredentialStatus,
): PrismaCredentialStatus {
  const values: Record<ProviderCredentialStatus, PrismaCredentialStatus> = {
    [PROVIDER_CREDENTIAL_STATUSES.pending]: PrismaCredentialStatus.PENDING,
    [PROVIDER_CREDENTIAL_STATUSES.active]: PrismaCredentialStatus.ACTIVE,
    [PROVIDER_CREDENTIAL_STATUSES.invalid]: PrismaCredentialStatus.INVALID,
    [PROVIDER_CREDENTIAL_STATUSES.expired]: PrismaCredentialStatus.EXPIRED,
    [PROVIDER_CREDENTIAL_STATUSES.revoking]: PrismaCredentialStatus.REVOKING,
    [PROVIDER_CREDENTIAL_STATUSES.revoked]: PrismaCredentialStatus.REVOKED,
    [PROVIDER_CREDENTIAL_STATUSES.storageError]:
      PrismaCredentialStatus.STORAGE_ERROR,
  };
  return values[status];
}
function fromCredentialStatus(
  status: PrismaCredentialStatus,
): ProviderCredentialStatus {
  const values: Record<PrismaCredentialStatus, ProviderCredentialStatus> = {
    [PrismaCredentialStatus.PENDING]: PROVIDER_CREDENTIAL_STATUSES.pending,
    [PrismaCredentialStatus.ACTIVE]: PROVIDER_CREDENTIAL_STATUSES.active,
    [PrismaCredentialStatus.INVALID]: PROVIDER_CREDENTIAL_STATUSES.invalid,
    [PrismaCredentialStatus.EXPIRED]: PROVIDER_CREDENTIAL_STATUSES.expired,
    [PrismaCredentialStatus.REVOKING]: PROVIDER_CREDENTIAL_STATUSES.revoking,
    [PrismaCredentialStatus.REVOKED]: PROVIDER_CREDENTIAL_STATUSES.revoked,
    [PrismaCredentialStatus.STORAGE_ERROR]:
      PROVIDER_CREDENTIAL_STATUSES.storageError,
  };
  return values[status];
}
