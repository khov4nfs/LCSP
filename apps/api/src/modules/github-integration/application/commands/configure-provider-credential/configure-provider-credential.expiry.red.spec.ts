import { describe, expect, it, jest } from "@jest/globals";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  CREDENTIAL_PROVIDERS,
  PROVIDER_CREDENTIAL_STATUSES,
} from "@lcsp/contracts/github-integration";

import { ConfigureProviderCredentialCommand } from "./configure-provider-credential.command.js";
import { ConfigureProviderCredentialHandler } from "./configure-provider-credential.handler.js";

describe("ConfigureProviderCredentialHandler repeated-secret expiry", () => {
  it("does not extend the known expiry when the same PAT is resubmitted with a later date", async () => {
    const originalExpiry = new Date("2098-01-01T00:00:00.000Z");
    const writes: Array<{ declaredExpiresAt: Date | null }> = [];
    const current = {
      id: "credential-1",
      provider: CREDENTIAL_PROVIDERS.gitlab,
      ownerUserId: "user-1",
      providerAccountId: 123n,
      providerAccountExternalId: null,
      providerLogin: "user",
      status: PROVIDER_CREDENTIAL_STATUSES.active,
      currentVersion: 1,
      declaredExpiresAt: originalExpiry,
      validatedAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    const tx = {
      providerCredentials: {
        findActiveByOwnerProvider: jest.fn(() => Promise.resolve(current)),
        updateForRotation: jest.fn(
          (
            _id: string,
            _userId: string,
            _version: number,
            data: typeof current,
          ) => {
            writes.push({ declaredExpiresAt: data.declaredExpiresAt });
            return Promise.resolve(true);
          },
        ),
      },
      database: {
        user: {
          findUnique: jest.fn(() =>
            Promise.resolve({ email: "user@example.test" }),
          ),
        },
      },
      credentialStore: {
        read: jest.fn(() => Promise.resolve("synthetic-same-pat-value-123")),
        replace: jest.fn(() => Promise.resolve()),
      },
    };
    const unitOfWork = {
      execute: (work: (transaction: typeof tx) => Promise<unknown>) => work(tx),
    };
    const handler = new ConfigureProviderCredentialHandler(
      { get: () => ({}) } as never,
      unitOfWork as never,
      {
        get: () => ({
          validateIdentity: () =>
            Promise.resolve({
              id: "123",
              login: "user",
              htmlUrl: "https://gitlab.com/user",
            }),
        }),
      } as never,
    );

    // Why: The declared lifetime belongs to the underlying PAT. Resubmitting
    // identical bytes with a later client hint must not extend that lifetime.
    await handler.execute(
      new ConfigureProviderCredentialCommand(
        "user-1",
        AUTH_USER_ROLES.customer,
        "session-1",
        CREDENTIAL_PROVIDERS.gitlab,
        "synthetic-same-pat-value-123",
        "corr-1",
        "2099-01-01T00:00:00.000Z",
      ),
    );
    expect(writes).toEqual([{ declaredExpiresAt: originalExpiry }]);
  });
});
