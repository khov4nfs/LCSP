import { randomBytes } from "node:crypto";

import { describe, expect, it } from "@jest/globals";
import { CredentialProvider, type Prisma } from "@prisma/client";
import { CREDENTIAL_PROVIDERS } from "@lcsp/contracts/github-integration";

import { DevelopmentStaticKeyEncryptionKeyProvider } from "../security/development-static-key-encryption-key.provider.js";
import { EnvelopeEncryptionService } from "../security/envelope-encryption.service.js";
import { PrismaDatabaseCredentialStore } from "./prisma-database-credential.store.js";

const SECRET = "phase-two-recognizable-secret";
const CONTEXT = {
  provider: CREDENTIAL_PROVIDERS.github,
  providerCredentialId: "credential-1",
  ownerUserId: "manager-1",
  credentialVersion: 1,
  envelopeVersion: 1,
};

function fixture(options: { failSecretCreate?: boolean } = {}) {
  const records = new Map<string, Record<string, unknown>>();
  const credential = {
    id: CONTEXT.providerCredentialId,
    provider: CredentialProvider.GITHUB,
    ownerUserId: CONTEXT.ownerUserId,
  };
  const client = {
    providerCredential: {
      findFirst: ({ where }: { where: { id: string; ownerUserId: string } }) =>
        Promise.resolve(
          where.id === credential.id &&
            where.ownerUserId === credential.ownerUserId
            ? { id: credential.id }
            : null,
        ),
      count: () => Promise.resolve(1),
      update: ({ data }: { data: Record<string, unknown> }) => {
        if (options.failSecretCreate) {
          return Promise.reject(new Error("simulated persistence failure"));
        }
        records.set(credential.id, { ...credential, ...data });
        return Promise.resolve(records.get(credential.id));
      },
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(records.get(where.id) ?? null),
      updateMany: ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        if (!records.has(where.id)) return Promise.resolve({ count: 0 });
        records.set(where.id, { ...records.get(where.id), ...data });
        return Promise.resolve({ count: 1 });
      },
    },
  } as unknown as Prisma.TransactionClient;
  const encryption = new EnvelopeEncryptionService(
    new DevelopmentStaticKeyEncryptionKeyProvider(
      "kek-v1",
      new Map([["kek-v1", randomBytes(32)]]),
    ),
  );
  return {
    records,
    store: new PrismaDatabaseCredentialStore(
      client as never,
      encryption,
      client,
    ),
  };
}

describe("PrismaDatabaseCredentialStore", () => {
  it("persists only encrypted bytes and reads through an opaque locator", async () => {
    const { records, store } = fixture();
    const locator = await store.store(SECRET, CONTEXT);
    expect(locator).toBe(CONTEXT.providerCredentialId);
    expect(JSON.stringify([...records.values()])).not.toContain(SECRET);
    await expect(store.read(locator)).resolves.toBe(SECRET);
  });

  it("replaces versions without confusing their AAD and destroys idempotently", async () => {
    const { store } = fixture();
    const oldLocator = await store.store(SECRET, CONTEXT);
    const newLocator = await store.replace(oldLocator, `${SECRET}-rotated`, {
      ...CONTEXT,
      credentialVersion: 2,
    });
    expect(newLocator).toBe(oldLocator);
    await expect(store.read(newLocator)).resolves.toBe(`${SECRET}-rotated`);
    await store.destroy(newLocator);
    await store.destroy(newLocator);
    await expect(store.read(newLocator)).rejects.toThrow(
      "credential_store_operation_failed",
    );
  });

  it("returns locator-free sanitized failures", async () => {
    const { store } = fixture();
    const locator = "unknown-locator" as never;
    await expect(store.read(locator)).rejects.toThrow(
      "credential_store_operation_failed",
    );
    try {
      await store.read(locator);
    } catch (error: unknown) {
      expect(String(error)).not.toContain(String(locator));
      expect(String(error)).not.toContain(SECRET);
    }
  });

  it("retains the safe failing operation and cause for local diagnostics", async () => {
    const { store } = fixture({ failSecretCreate: true });

    try {
      await store.store(SECRET, CONTEXT);
      throw new Error("expected store to fail");
    } catch (error: unknown) {
      expect(error).toMatchObject({
        name: "CredentialStoreError",
        operation: "provider_credential_envelope_update",
      });
      expect((error as Error).cause).toBeInstanceOf(Error);
      expect(String(error)).not.toContain(SECRET);
    }
  });

  it("maps tampered persisted envelopes to a sanitized store failure", async () => {
    const { records, store } = fixture();
    const locator = await store.store(SECRET, CONTEXT);
    const row = records.get(locator);
    const ciphertext = row?.ciphertext as Uint8Array;
    ciphertext[0] ^= 0xff;
    await expect(store.read(locator)).rejects.toThrow(
      "credential_store_operation_failed",
    );
    await expect(store.read(locator)).rejects.not.toThrow(SECRET);
  });
});
