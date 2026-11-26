import {
  CredentialProvider as PrismaProvider,
  ProviderCredentialStatus as PrismaStatus,
} from "@prisma/client";
import { describe, expect, it, jest } from "@jest/globals";
import {
  CREDENTIAL_PROVIDERS,
  PROVIDER_CREDENTIAL_STATUSES,
} from "@lcsp/contracts/github-integration";
import { PrismaProviderCredentialRepository } from "./prisma-credential.repositories.js";

describe("PrismaProviderCredentialRepository provider identities", () => {
  type CreateCall = (input: {
    data: Record<string, unknown>;
  }) => Promise<unknown>;
  type FindCall = (input: unknown) => Promise<unknown>;

  it("persists and retrieves the exact Bitbucket UUID without a numeric substitute", async () => {
    const uuid = "{12345678-1234-4234-8234-123456789abc}";
    const create = jest.fn<CreateCall>();
    const findFirst = jest.fn<FindCall>().mockResolvedValue({
      id: "credential-bb",
      provider: PrismaProvider.BITBUCKET,
      ownerUserId: "owner-1",
      providerAccountId: null,
      providerAccountExternalId: uuid,
      providerLogin: "bb-user",
      status: PrismaStatus.ACTIVE,
      currentVersion: 3,
      declaredExpiresAt: null,
      validatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    const repository = new PrismaProviderCredentialRepository(
      {} as never,
      {
        providerCredential: { create, findFirst },
      } as never,
    );
    await repository.create({
      id: "credential-bb",
      provider: CREDENTIAL_PROVIDERS.bitbucket,
      ownerUserId: "owner-1",
      providerAccountId: null,
      providerAccountExternalId: uuid,
      providerLogin: "bb-user",
      status: PROVIDER_CREDENTIAL_STATUSES.active,
      currentVersion: 3,
      declaredExpiresAt: null,
      validatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    const row = await repository.findActiveByOwnerProvider(
      "owner-1",
      CREDENTIAL_PROVIDERS.bitbucket,
    );
    expect(create.mock.calls[0][0].data).toMatchObject({
      providerAccountId: null,
      providerAccountExternalId: uuid,
    });
    expect(row).toMatchObject({
      providerAccountId: null,
      providerAccountExternalId: uuid,
    });
  });

  it.each([PrismaProvider.GITHUB, PrismaProvider.GITLAB])(
    "keeps legacy numeric account identities for %s",
    async (provider) => {
      const findFirst = jest.fn<FindCall>().mockResolvedValue({
        id: "credential-numeric",
        provider,
        ownerUserId: "owner-1",
        providerAccountId: 123456789n,
        providerAccountExternalId: null,
        providerLogin: "legacy-user",
        status: PrismaStatus.ACTIVE,
        currentVersion: 1,
        declaredExpiresAt: null,
        validatedAt: null,
      });
      const repository = new PrismaProviderCredentialRepository(
        {} as never,
        {
          providerCredential: { findFirst },
        } as never,
      );
      const contractProvider =
        provider === PrismaProvider.GITLAB
          ? CREDENTIAL_PROVIDERS.gitlab
          : CREDENTIAL_PROVIDERS.github;
      await expect(
        repository.findActiveByOwnerProvider("owner-1", contractProvider),
      ).resolves.toMatchObject({
        providerAccountId: 123456789n,
        providerAccountExternalId: null,
      });
    },
  );
});
