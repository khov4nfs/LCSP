import { CredentialProvider, ProviderCredentialStatus } from "@prisma/client";
import { describe, expect, it, jest } from "@jest/globals";
import { PrismaActiveProviderCredentialResolver } from "./prisma-active-provider-credential.resolver.js";

describe("PrismaActiveProviderCredentialResolver", () => {
  it("selects the deterministic latest validated active credential in scope", async () => {
    const findFirst = jest
      .fn<(input: unknown) => Promise<unknown>>()
      .mockResolvedValue({
        id: "credential-b",
        provider: CredentialProvider.GITLAB,
        providerAccountId: 42n,
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
});
