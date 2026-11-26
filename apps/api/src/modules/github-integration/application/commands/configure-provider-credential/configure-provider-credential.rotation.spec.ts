import { describe, expect, it, jest } from "@jest/globals";
import { HttpException } from "@nestjs/common";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  CREDENTIAL_PROVIDERS,
  GITHUB_CREDENTIAL_ERROR_CODES,
  PROVIDER_CREDENTIAL_STATUSES,
} from "@lcsp/contracts/github-integration";

import { GitLabCliProviderError } from "../../../infrastructure/gitlab/gitlab-cli-repository.provider.js";
import { ConfigureProviderCredentialCommand } from "./configure-provider-credential.command.js";
import { ConfigureProviderCredentialHandler } from "./configure-provider-credential.handler.js";

const existingCredential = {
  id: "credential-1",
  provider: CREDENTIAL_PROVIDERS.gitlab,
  ownerUserId: "user-1",
  providerAccountId: 10n,
  providerAccountExternalId: null,
  providerLogin: "old-account",
  status: PROVIDER_CREDENTIAL_STATUSES.active,
  currentVersion: 1,
  declaredExpiresAt: null,
  validatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

function build(
  options: {
    validationError?: Error;
    rotationAccepted?: boolean;
    credentialExpiresAt?: string;
    identityId?: string;
  } = {},
) {
  const updateForRotation = jest
    .fn<(...args: unknown[]) => Promise<boolean>>()
    .mockResolvedValue(options.rotationAccepted ?? true);
  const replace = jest
    .fn<(...args: unknown[]) => Promise<void>>()
    .mockResolvedValue(undefined);
  const create = jest.fn<(...args: unknown[]) => Promise<void>>();
  let transactionCount = 0;
  const unitOfWork = {
    execute: async (work: (transaction: unknown) => Promise<unknown>) => {
      transactionCount += 1;
      if (transactionCount === 1) {
        return work({
          providerCredentials: {
            findActiveByOwnerProvider: jest.fn(() =>
              Promise.resolve(existingCredential),
            ),
          },
          database: {
            user: {
              findUnique: jest.fn(() =>
                Promise.resolve({ email: "user@example.test" }),
              ),
            },
          },
        });
      }
      return work({
        providerCredentials: {
          updateForRotation,
          create,
        },
        credentialStore: { replace },
      });
    },
  };
  const validateIdentity = jest.fn(() =>
    options.validationError
      ? Promise.reject(options.validationError)
      : Promise.resolve({
          id: options.identityId ?? "42",
          login: "new-account",
          htmlUrl: "https://gitlab.com/new-account",
        }),
  );
  const handler = new ConfigureProviderCredentialHandler(
    { get: () => ({}) } as never,
    unitOfWork as never,
    { get: () => ({ validateIdentity }) } as never,
  );
  const command = new ConfigureProviderCredentialCommand(
    "user-1",
    AUTH_USER_ROLES.customer,
    "session-1",
    CREDENTIAL_PROVIDERS.gitlab,
    "replacement-token-value-long-enough",
    "corr-rotation",
    options.credentialExpiresAt,
  );
  return {
    handler,
    command,
    updateForRotation,
    replace,
    create,
    validateIdentity,
  };
}

describe("ConfigureProviderCredentialHandler explicit rotation", () => {
  it("validates and atomically stores the next version without rebinding repository connections", async () => {
    const fixture = build();

    const result = await fixture.handler.execute(fixture.command);

    expect(result).toMatchObject({
      provider: CREDENTIAL_PROVIDERS.gitlab,
      configured: true,
      account: { id: "42", username: "new-account" },
    });
    expect(fixture.updateForRotation).toHaveBeenCalledWith(
      "credential-1",
      "user-1",
      1,
      expect.objectContaining({
        currentVersion: 2,
        status: PROVIDER_CREDENTIAL_STATUSES.active,
      }),
    );
    expect(fixture.replace).toHaveBeenCalledWith(
      "credential-1",
      "replacement-token-value-long-enough",
      expect.objectContaining({ credentialVersion: 2 }),
    );
    expect(fixture.create).not.toHaveBeenCalled();
  });

  it("preserves the previous valid credential when replacement validation fails", async () => {
    const fixture = build({
      validationError: new GitLabCliProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
      ),
    });

    let rejection: unknown;
    try {
      await fixture.handler.execute(fixture.command);
    } catch (error: unknown) {
      rejection = error;
    }

    expect(rejection).toBeInstanceOf(HttpException);
    expect((rejection as HttpException).getStatus()).toBe(401);
    expect(fixture.updateForRotation).not.toHaveBeenCalled();
    expect(fixture.replace).not.toHaveBeenCalled();
  });

  it("rejects a nonnumeric legacy-provider identity instead of hashing it", async () => {
    const fixture = build({ identityId: "opaque-provider-id" });

    await expect(
      fixture.handler.execute(fixture.command),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        problem: expect.objectContaining({
          code: GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid,
        }),
      }),
    });
    expect(fixture.updateForRotation).not.toHaveBeenCalled();
    expect(fixture.replace).not.toHaveBeenCalled();
  });

  it("does not replace the secret when the stored credential version changed concurrently", async () => {
    const fixture = build({ rotationAccepted: false });

    await expect(fixture.handler.execute(fixture.command)).rejects.toThrow(
      "provider_credential_version_conflict",
    );

    expect(fixture.updateForRotation).toHaveBeenCalledTimes(1);
    expect(fixture.replace).not.toHaveBeenCalled();
  });

  it("persists user-declared credential expiry only after validation", async () => {
    const fixture = build({
      credentialExpiresAt: "2027-01-01T00:00:00.000Z",
    });

    await fixture.handler.execute(fixture.command);

    expect(fixture.validateIdentity).toHaveBeenCalledTimes(1);
    expect(fixture.updateForRotation).toHaveBeenCalledWith(
      "credential-1",
      "user-1",
      1,
      expect.objectContaining({
        declaredExpiresAt: new Date("2027-01-01T00:00:00.000Z"),
      }),
    );
  });

  it("rejects an elapsed declared expiry before replacing the stored credential", async () => {
    const fixture = build({
      credentialExpiresAt: "2020-01-01T00:00:00.000Z",
    });

    await expect(
      fixture.handler.execute(fixture.command),
    ).rejects.toBeInstanceOf(HttpException);

    expect(fixture.updateForRotation).not.toHaveBeenCalled();
    expect(fixture.replace).not.toHaveBeenCalled();
  });
});
