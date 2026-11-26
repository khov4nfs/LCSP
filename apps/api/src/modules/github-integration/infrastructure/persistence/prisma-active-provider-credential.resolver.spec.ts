import { CredentialProvider, ProviderCredentialStatus } from "@prisma/client";
import { describe, expect, it, jest } from "@jest/globals";
import { GITHUB_CREDENTIAL_ERROR_CODES } from "@lcsp/contracts/github-integration";
import { CredentialResolutionError } from "./prisma-credential-authorization.resolver.js";
import { PrismaActiveProviderCredentialResolver } from "./prisma-active-provider-credential.resolver.js";

describe("PrismaActiveProviderCredentialResolver", () => {
  it("selects the deterministic latest validated active credential in scope", async () => {
    const findFirst = jest
      .fn<(input: unknown) => Promise<unknown>>()
      .mockResolvedValue({
        id: "credential-b",
        provider: CredentialProvider.GITLAB,
        providerAccountId: 42n,
        providerAccountExternalId: null,
        providerLogin: "tester",
        currentVersion: 1,
        status: ProviderCredentialStatus.ACTIVE,
        isActive: true,
      });
    const resolver = new PrismaActiveProviderCredentialResolver(
      { providerCredential: { findFirst } } as never,
      {} as never,
    );

    const metadata = await resolver.findMetadata({
      userId: "user-1",
      provider: CredentialProvider.GITLAB,
    });

    expect(metadata?.id).toBe("credential-b");
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        ownerUserId: "user-1",
        provider: CredentialProvider.GITLAB,
        status: ProviderCredentialStatus.ACTIVE,
        isActive: true,
      },
      orderBy: [{ validatedAt: "desc" }, { id: "desc" }],
      select: expect.objectContaining({ id: true, currentVersion: true }),
    });
  });

  it("projects the exact persisted Bitbucket UUID without numeric coercion", async () => {
    const uuid = "{12345678-1234-4234-8234-123456789abc}";
    const findFirst = jest
      .fn<(input: unknown) => Promise<unknown>>()
      .mockResolvedValue({
        id: "credential-bb",
        provider: CredentialProvider.BITBUCKET,
        providerAccountId: null,
        providerAccountExternalId: uuid,
        providerLogin: "workspace-user",
        currentVersion: 2,
        status: ProviderCredentialStatus.ACTIVE,
        isActive: true,
      });
    const resolver = new PrismaActiveProviderCredentialResolver(
      { providerCredential: { findFirst } } as never,
      {} as never,
    );
    await expect(
      resolver.findMetadata({
        userId: "owner",
        provider: CredentialProvider.BITBUCKET,
      }),
    ).resolves.toMatchObject({ providerAccountId: uuid });
  });

  it("classifies an absent active credential as required", async () => {
    const findFirst = jest
      .fn<(input: unknown) => Promise<unknown>>()
      .mockResolvedValue(null);
    const resolver = new PrismaActiveProviderCredentialResolver(
      { providerCredential: { findFirst } } as never,
      {} as never,
    );

    await expect(
      resolver.resolveActiveCredential({
        userId: "owner",
        provider: CredentialProvider.BITBUCKET,
        repositoryFullName: "workspace/repository",
      }),
    ).rejects.toMatchObject<Partial<CredentialResolutionError>>({
      code: GITHUB_CREDENTIAL_ERROR_CODES.credentialRequired,
    });
  });
});
