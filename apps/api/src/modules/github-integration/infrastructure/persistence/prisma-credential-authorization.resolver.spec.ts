import { describe, expect, it, jest } from "@jest/globals";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import {
  CredentialAuthorizationStatus,
  ProviderCredentialStatus,
} from "@prisma/client";
import {
  GITHUB_CREDENTIAL_ERROR_CODES,
  GITHUB_CREDENTIAL_OPERATIONS,
} from "@lcsp/contracts/github-integration";
import type { CredentialStorePort } from "../../application/ports/security/credential-store.port.js";
import { PrismaCredentialAuthorizationResolver } from "./prisma-credential-authorization.resolver.js";

const context = {
  actorId: "manager-1",
  userId: "manager-1",
  assessmentId: "assessment-1",
  operation: GITHUB_CREDENTIAL_OPERATIONS.pinSnapshot,
  correlationId: "correlation-1",
};

function binding(overrides: Record<string, unknown> = {}) {
  const authorization =
    (overrides.authorization as Record<string, unknown> | undefined) ?? {};
  const credential = {
    id: "credential-1",
    ownerUserId: "manager-1",
    status: ProviderCredentialStatus.ACTIVE,
    currentVersion: 1,
    declaredExpiresAt: new Date(Date.now() + 60_000),
    ...(overrides.credential as object | undefined),
  };
  return {
    id: "connection-1",
    assessmentId: authorization.assessmentId ?? "assessment-1",
    repositoryId: authorization.repositoryId ?? "100",
    repositoryFullName: authorization.repositoryFullName ?? "owner/repo",
    userId: "manager-1",
    status: "ACTIVE",
    authenticationMode: "GITHUB_CLI_CREDENTIAL",
    providerCredentialId: credential.id,
    credentialVersion: authorization.credentialVersion ?? 1,
    credentialAuthorizationStatus:
      authorization.status ?? CredentialAuthorizationStatus.ACTIVE,
    credentialAuthorizedByUserId: "manager-1",
    credentialValidatedAt: new Date(),
    providerCredential: credential,
    ...overrides,
  };
}

function resolver(row: ReturnType<typeof binding> | null) {
  const findFirst = jest.fn(() => Promise.resolve(row));
  const read = jest.fn(() => Promise.resolve("resolved-secret"));
  const prisma = {
    repositoryConnection: { findFirst },
  } as unknown as PrismaService;
  const store = {
    read,
  } as unknown as CredentialStorePort;
  return {
    resolver: new PrismaCredentialAuthorizationResolver(prisma, store),
    read,
  };
}

describe("PrismaCredentialAuthorizationResolver", () => {
  it("resolves only through an account/repository/assessment-bound connection", async () => {
    const fixture = resolver(binding());
    const lease = await fixture.resolver.resolveForConnection(
      context,
      "connection-1",
      "owner/repo",
    );
    expect(lease.withSecret((secret) => secret)).toBe("resolved-secret");
    expect(fixture.read).toHaveBeenCalledTimes(1);
    lease.dispose();
  });

  it.each([
    ["cross account", { credential: { ownerUserId: "other-user" } }],
    ["repository mismatch", { repositoryFullName: "other/repo" }],
    [
      "assessment mismatch",
      { authorization: { assessmentId: "assessment-2" } },
    ],
    [
      "revoked authorization",
      { authorization: { status: CredentialAuthorizationStatus.REVOKED } },
    ],
    ["version mismatch", { authorization: { credentialVersion: 2 } }],
    [
      "invalid credential",
      { credential: { status: ProviderCredentialStatus.INVALID } },
    ],
  ])("fails closed for %s", async (_name, overrides) => {
    const fixture = resolver(binding(overrides));
    await expect(
      fixture.resolver.resolveForConnection(
        context,
        "connection-1",
        "owner/repo",
      ),
    ).rejects.toThrow("CREDENTIAL_INVALID");
    expect(fixture.read).not.toHaveBeenCalled();
  });

  it("returns the safe expired category without reading the secret", async () => {
    const fixture = resolver(
      binding({ credential: { declaredExpiresAt: new Date(0) } }),
    );
    await expect(
      fixture.resolver.resolveForConnection(
        context,
        "connection-1",
        "owner/repo",
      ),
    ).rejects.toThrow("CREDENTIAL_EXPIRED");
    expect(fixture.read).not.toHaveBeenCalled();
  });

  it("rejects a different account from consuming the connection", async () => {
    const fixture = resolver(
      binding({ credential: { ownerUserId: "manager-owner" } }),
    );
    await expect(
      fixture.resolver.resolveForConnection(
        { ...context, actorId: "developer-1" },
        "connection-1",
        "owner/repo",
      ),
    ).rejects.toThrow("CREDENTIAL_INVALID");
  });

  it("does not grant a Developer credential stewardship authority", async () => {
    const findFirst = jest.fn(() => Promise.resolve(null));
    const prisma = {
      repositoryConnection: { findFirst },
    } as unknown as PrismaService;
    const instance = new PrismaCredentialAuthorizationResolver(prisma, {
      read: jest.fn(),
    } as unknown as CredentialStorePort);
    await expect(
      instance.assertRotationAuthority(
        {
          ...context,
          actorId: "developer-1",
          operation: GITHUB_CREDENTIAL_OPERATIONS.rotate,
        },
        "connection-1",
      ),
    ).rejects.toThrow("CREDENTIAL_INVALID");
    expect((findFirst.mock.calls as unknown[][])[0]?.[0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          providerCredential: expect.objectContaining({
            ownerUserId: "manager-1",
          }),
        }),
      }),
    );
  });

  it("does not let an old in-flight version invalidate a rotated version", async () => {
    const updateMany = jest.fn(() => Promise.resolve({ count: 0 }));
    const prisma = {
      repositoryConnection: {
        findFirst: jest.fn(() =>
          Promise.resolve({
            providerCredential: {
              id: "credential-1",
              ownerUserId: "manager-1",
            },
            credentialVersion: 2,
          }),
        ),
      },
      providerCredential: { updateMany },
    } as unknown as PrismaService;
    const instance = new PrismaCredentialAuthorizationResolver(prisma, {
      read: jest.fn(),
    } as unknown as CredentialStorePort);
    await instance.markInvalid(
      "connection-1",
      1,
      GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
    );
    expect(updateMany).not.toHaveBeenCalled();
  });
});
