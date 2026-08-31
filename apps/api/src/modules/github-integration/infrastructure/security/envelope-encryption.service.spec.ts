import { randomBytes } from "node:crypto";
import { inspect } from "node:util";

import { describe, expect, it } from "@jest/globals";
import { CREDENTIAL_PROVIDERS } from "@lcsp/contracts/github-integration";

import { DevelopmentStaticKeyEncryptionKeyProvider } from "./development-static-key-encryption-key.provider.js";
import {
  EnvelopeEncryptionService,
  type EncryptedSecretEnvelope,
} from "./envelope-encryption.service.js";
import { InMemoryEncryptedCredentialStore } from "./in-memory-encrypted-credential.store.js";
import type { CredentialStorageContext } from "../../application/ports/security/credential-store.port.js";

const SECRET = "recognizable-test-envelope-secret";
const STORAGE_CONTEXT = {
  provider: CREDENTIAL_PROVIDERS.github,
  providerCredentialId: "credential-1",
  ownerUserId: "manager-1",
  credentialVersion: 1,
  envelopeVersion: 1,
};

function provider(version = "kek-v1", key = randomBytes(32)) {
  return new DevelopmentStaticKeyEncryptionKeyProvider(
    version,
    new Map([[version, key]]),
  );
}

function mutateBase64(value: string): string {
  const bytes = Buffer.from(value, "base64");
  bytes[0] ^= 0xff;
  return bytes.toString("base64");
}

function cloneEnvelope(
  envelope: EncryptedSecretEnvelope,
): EncryptedSecretEnvelope {
  return structuredClone(envelope);
}

describe("EnvelopeEncryptionService", () => {
  it("redacts development KEK provider inspection", () => {
    const key = Buffer.alloc(32, 7);
    const keyProvider = provider("kek-v1", key);

    expect(inspect(keyProvider)).toBe(
      "[DevelopmentStaticKeyEncryptionKeyProvider redacted]",
    );
    expect(inspect(keyProvider)).not.toContain(key.toString("hex"));
  });

  it("round-trips a secret without serializing plaintext", async () => {
    const encryption = new EnvelopeEncryptionService(provider());
    const envelope = await encryption.encryptSecret(SECRET);

    await expect(encryption.decryptSecret(envelope)).resolves.toBe(SECRET);
    expect(JSON.stringify(envelope)).not.toContain(SECRET);
    expect(envelope.algorithm).toBe("AES_256_GCM");
    expect(envelope.version).toBe(1);
    expect(envelope.wrappedDataEncryptionKey.keyVersion).toBe("kek-v1");
  });

  it("round-trips GitLab credentials with the same envelope protection", async () => {
    const encryption = new EnvelopeEncryptionService(provider());
    const context = {
      ...STORAGE_CONTEXT,
      provider: CREDENTIAL_PROVIDERS.gitlab,
    };
    const envelope = await encryption.encryptSecret(SECRET, context);

    await expect(encryption.decryptSecret(envelope, context)).resolves.toBe(
      SECRET,
    );
  });

  it("uses fresh DEKs and nonces for identical plaintext", async () => {
    const encryption = new EnvelopeEncryptionService(provider());
    const first = await encryption.encryptSecret(SECRET);
    const second = await encryption.encryptSecret(SECRET);

    expect(first).not.toEqual(second);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.wrappedDataEncryptionKey.ciphertext).not.toBe(
      second.wrappedDataEncryptionKey.ciphertext,
    );
  });

  it.each([
    ["providerCredentialId", "credential-2"],
    ["ownerUserId", "manager-2"],
    ["credentialVersion", 2],
  ] as const)("binds encrypted data to %s", async (field, value) => {
    const encryption = new EnvelopeEncryptionService(provider());
    const envelope = await encryption.encryptSecret(SECRET, STORAGE_CONTEXT);
    await expect(
      encryption.decryptSecret(envelope, {
        ...STORAGE_CONTEXT,
        [field]: value,
      }),
    ).rejects.toThrow("credential_encryption_failed");
  });

  it.each([
    ["provider", "NOT_GITHUB"],
    ["envelopeVersion", 2],
  ] as const)("fails safely when AAD %s changes", async (field, value) => {
    const encryption = new EnvelopeEncryptionService(provider());
    const envelope = await encryption.encryptSecret(SECRET, STORAGE_CONTEXT);
    const changed = {
      ...STORAGE_CONTEXT,
      [field]: value,
    } as CredentialStorageContext;
    await expect(encryption.decryptSecret(envelope, changed)).rejects.toThrow(
      "credential_encryption_failed",
    );
  });

  it("rejects swapping wrapped DEKs between credential contexts", async () => {
    const encryption = new EnvelopeEncryptionService(provider());
    const first = await encryption.encryptSecret(SECRET, STORAGE_CONTEXT);
    const secondContext = {
      ...STORAGE_CONTEXT,
      providerCredentialId: "credential-2",
    };
    const second = await encryption.encryptSecret(SECRET, secondContext);
    first.wrappedDataEncryptionKey = second.wrappedDataEncryptionKey;
    await expect(
      encryption.decryptSecret(first, STORAGE_CONTEXT),
    ).rejects.toThrow("credential_encryption_failed");
  });

  it("fails safely with the wrong KEK", async () => {
    const envelope = await new EnvelopeEncryptionService(
      provider("kek-v1", Buffer.alloc(32, 1)),
    ).encryptSecret(SECRET);
    const wrong = new EnvelopeEncryptionService(
      provider("kek-v1", Buffer.alloc(32, 2)),
    );

    await expect(wrong.decryptSecret(envelope)).rejects.toThrow(
      "credential_encryption_failed",
    );
  });

  it("honors key versions and fails safely when a version is unavailable", async () => {
    const envelope = await new EnvelopeEncryptionService(
      provider("kek-v1"),
    ).encryptSecret(SECRET);
    const unavailable = new EnvelopeEncryptionService(provider("kek-v2"));

    await expect(unavailable.decryptSecret(envelope)).rejects.toThrow(
      "credential_encryption_failed",
    );
  });

  it.each(["ciphertext", "nonce", "authenticationTag"] as const)(
    "rejects modified envelope %s",
    async (field) => {
      const encryption = new EnvelopeEncryptionService(provider());
      const envelope = await encryption.encryptSecret(SECRET);
      const modified = cloneEnvelope(envelope);
      modified[field] = mutateBase64(modified[field]);

      await expect(encryption.decryptSecret(modified)).rejects.toThrow(
        "credential_encryption_failed",
      );
    },
  );

  it.each(["ciphertext", "nonce", "authenticationTag"] as const)(
    "rejects modified wrapped DEK %s",
    async (field) => {
      const encryption = new EnvelopeEncryptionService(provider());
      const envelope = await encryption.encryptSecret(SECRET);
      const modified = cloneEnvelope(envelope);
      modified.wrappedDataEncryptionKey[field] = mutateBase64(
        modified.wrappedDataEncryptionKey[field],
      );

      await expect(encryption.decryptSecret(modified)).rejects.toThrow(
        "credential_encryption_failed",
      );
    },
  );

  it("keeps credential store failures locator-free and secret-free", async () => {
    const store = new InMemoryEncryptedCredentialStore(
      new EnvelopeEncryptionService(provider()),
    );
    const locator = await store.store(SECRET, STORAGE_CONTEXT);

    await expect(store.read(locator)).resolves.toBe(SECRET);
    await store.destroy(locator);
    let failure: unknown;
    try {
      await store.read(locator);
    } catch (error: unknown) {
      failure = error;
    }
    expect(String(failure)).toBe(
      "CredentialStoreError: credential_store_operation_failed",
    );
    expect(String(failure)).not.toContain(SECRET);
    expect(String(failure)).not.toContain(locator);
  });
});
