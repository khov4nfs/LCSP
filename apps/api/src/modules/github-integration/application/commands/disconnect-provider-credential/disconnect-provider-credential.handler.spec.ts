/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, it, jest } from "@jest/globals";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  CREDENTIAL_AUTHORIZATION_STATUSES,
  CREDENTIAL_PROVIDERS,
  GITHUB_INTEGRATION_ERROR_CODES,
  GITHUB_INTEGRATION_EVENT_TYPES,
  PROVIDER_CREDENTIAL_STATUSES,
} from "@lcsp/contracts/github-integration";

import { DisconnectProviderCredentialCommand } from "./disconnect-provider-credential.command.js";
import { DisconnectProviderCredentialHandler } from "./disconnect-provider-credential.handler.js";

const USER_ID = "user-owner";
const CREDENTIAL_ID = "cred-1";

const fn = <T>(impl: (...args: unknown[]) => Promise<T>) =>
  jest.fn<(...args: unknown[]) => Promise<T>>(impl);

function build(current: { id: string } | null, revoked = true) {
  const calls: string[] = [];
  const staged: string[] = [];
  const transaction = {
    providerCredentials: {
      findActiveByOwnerProvider: fn(async () => current),
      updateLifecycle: fn(async () => {
        staged.push("revoking");
        return true;
      }),
      markRevoked: fn(async () => {
        staged.push("revoked");
        return revoked;
      }),
    },
    credentialStore: {
      destroy: fn(async () => {
        staged.push("destroy");
      }),
    },
    database: {
      repositoryConnection: {
        updateMany: fn(async () => {
          staged.push("connections");
          return { count: 2 };
        }),
      },
    },
  };
  const unitOfWork = {
    execute: fn(async (work) => {
      const result = await (
        work as (tx: typeof transaction) => Promise<unknown>
      )(transaction);
      // The fake publishes staged writes only after all transaction steps pass.
      calls.push(...staged);
      return result;
    }),
  };
  const auditWriter = { writeInTx: fn(async () => undefined) };
  const handler = new DisconnectProviderCredentialHandler(
    unitOfWork as never,
    auditWriter as never,
  );
  return { handler, transaction, auditWriter, calls };
}

function command(
  provider: string = CREDENTIAL_PROVIDERS.github,
  role: string = AUTH_USER_ROLES.customer,
) {
  return new DisconnectProviderCredentialCommand(
    USER_ID,
    role,
    "session-1",
    provider,
    "corr-1",
  );
}

describe("DisconnectProviderCredentialHandler", () => {
  it("does not commit revocation when its audit cannot be persisted", async () => {
    const { handler, auditWriter, calls } = build({ id: CREDENTIAL_ID });
    // Why: A failed audit must leave the credential usable for a safe retry;
    // otherwise retry sees no active credential and permanently loses the event.
    auditWriter.writeInTx.mockRejectedValueOnce(
      new Error("audit store unavailable"),
    );

    await expect(handler.execute(command())).rejects.toThrow(
      "audit store unavailable",
    );
    expect(calls).toEqual([]);
  });

  it("destroys the secret, revokes bound connections and audits without credential data", async () => {
    const { handler, transaction, auditWriter, calls } = build({
      id: CREDENTIAL_ID,
    });

    await expect(handler.execute(command())).resolves.toEqual({
      provider: CREDENTIAL_PROVIDERS.github,
      configured: false,
      status: PROVIDER_CREDENTIAL_STATUSES.revoked,
    });

    expect(calls).toEqual(["revoking", "destroy", "connections", "revoked"]);
    expect(transaction.credentialStore.destroy).toHaveBeenCalledWith(
      CREDENTIAL_ID,
    );
    expect(
      transaction.database.repositoryConnection.updateMany,
    ).toHaveBeenCalledWith({
      where: { providerCredentialId: CREDENTIAL_ID, userId: USER_ID },
      data: {
        credentialAuthorizationStatus:
          CREDENTIAL_AUTHORIZATION_STATUSES.revoked,
        credentialRevokedAt: expect.any(Date),
      },
    });
    expect(auditWriter.writeInTx).toHaveBeenCalledTimes(1);
    const event = auditWriter.writeInTx.mock.calls[0][0] as {
      eventType: string;
      payload: Record<string, unknown>;
    };
    expect(event.eventType).toBe(
      GITHUB_INTEGRATION_EVENT_TYPES.providerCredentialDisconnected,
    );
    expect(event.payload).toEqual({ provider: CREDENTIAL_PROVIDERS.github });
  });

  it("scopes every lookup and write to the calling account", async () => {
    const { handler, transaction } = build({ id: CREDENTIAL_ID });
    await handler.execute(command(CREDENTIAL_PROVIDERS.gitlab));
    expect(
      transaction.providerCredentials.findActiveByOwnerProvider,
    ).toHaveBeenCalledWith(USER_ID, CREDENTIAL_PROVIDERS.gitlab);
    expect(transaction.providerCredentials.markRevoked).toHaveBeenCalledWith(
      CREDENTIAL_ID,
      USER_ID,
      expect.any(Date),
    );
  });

  it("is idempotent when nothing is connected and writes no audit event", async () => {
    const { handler, transaction, auditWriter } = build(null);
    await expect(handler.execute(command())).resolves.toEqual({
      provider: CREDENTIAL_PROVIDERS.github,
      configured: false,
      status: null,
    });
    expect(transaction.credentialStore.destroy).not.toHaveBeenCalled();
    expect(auditWriter.writeInTx).not.toHaveBeenCalled();
  });

  it("rejects unknown providers and non-customer roles before touching storage", async () => {
    const { handler, transaction } = build({ id: CREDENTIAL_ID });
    await expect(handler.execute(command("NOPE"))).rejects.toMatchObject({
      response: expect.objectContaining({
        problem: expect.objectContaining({
          code: GITHUB_INTEGRATION_ERROR_CODES.credentialRequestInvalid,
          status: 400,
        }),
      }),
    });
    await expect(
      handler.execute(command(CREDENTIAL_PROVIDERS.github, "ADMIN")),
    ).rejects.toBeDefined();
    expect(
      transaction.providerCredentials.findActiveByOwnerProvider,
    ).not.toHaveBeenCalled();
  });

  it("fails without audit or success when the revocation write does not apply", async () => {
    const { handler, auditWriter } = build({ id: CREDENTIAL_ID }, false);
    await expect(handler.execute(command())).rejects.toThrow(
      "provider_credential_revoke_conflict",
    );
    expect(auditWriter.writeInTx).not.toHaveBeenCalled();
  });
});
