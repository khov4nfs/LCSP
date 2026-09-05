import { Inject, Injectable } from "@nestjs/common";
import { CredentialProvider, ProviderCredentialStatus } from "@prisma/client";
import { CREDENTIAL_PROVIDERS } from "@lcsp/contracts/github-integration";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type {
  ActiveProviderCredentialMetadata,
  ActiveProviderCredentialResolver,
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
    if (!row || !row.ciphertext) {
      throw new CredentialResolutionError(
        GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
      );
    }
    const metadata: ActiveProviderCredentialMetadata = {
      id: row.id,
      provider: fromPrismaProvider(row.provider),
      providerAccountId: row.providerAccountId.toString(),
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
        providerLogin: true,
        currentVersion: true,
      },
    });
    return row
      ? {
          id: row.id,
          provider: fromPrismaProvider(row.provider),
          providerAccountId: row.providerAccountId.toString(),
          providerLogin: row.providerLogin,
          currentVersion: row.currentVersion,
        }
      : null;
  }

  async resolveLease(input: {
    userId: string;
    provider: CredentialProvider;
    repositoryFullName: string;
  }): Promise<CredentialLease> {
    return (await this.resolveActiveCredential(input)).lease;
  }
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
