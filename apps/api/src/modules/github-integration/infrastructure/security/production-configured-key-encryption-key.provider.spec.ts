import { inspect } from "node:util";

import { describe, expect, it } from "@jest/globals";

import { DevelopmentStaticKeyEncryptionKeyProvider } from "./development-static-key-encryption-key.provider.js";
import { ProductionConfiguredKeyEncryptionKeyProvider } from "./production-configured-key-encryption-key.provider.js";
import { createCredentialKeyEncryptionKeyProvider } from "./credential-key-encryption-key-provider.factory.js";
import { KEY_ENCRYPTION_KEY_PROVIDER_HEALTH_STATUSES } from "../../application/ports/security/key-encryption-key-provider.port.js";

const AAD = Buffer.from("safe-aad", "utf8");

function keyring(entries: Record<string, Buffer>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(entries).map(([version, key]) => [
        version,
        key.toString("base64"),
      ]),
    ),
  );
}

describe("ProductionConfiguredKeyEncryptionKeyProvider", () => {
  it("returns a fail-closed provider while credential persistence is disabled", async () => {
    const provider = createCredentialKeyEncryptionKeyProvider({
      enabled: false,
      snapshotPinningEnabled: false,
      archiveRetrievalEnabled: false,
      activeKekVersion: "",
      encodedKekKeyring: "{}",
    });
    await expect(provider.wrapKey(Buffer.alloc(32))).rejects.toThrow(
      "credential_storage_disabled",
    );
    await expect(provider.health()).resolves.toEqual({
      status: KEY_ENCRYPTION_KEY_PROVIDER_HEALTH_STATUSES.unavailable,
      activeKeyVersion: null,
    });
  });
  it("redacts inspection and serialization", () => {
    const recognizable = Buffer.alloc(32, 7);
    const provider = new ProductionConfiguredKeyEncryptionKeyProvider(
      "kek-v1",
      keyring({ "kek-v1": recognizable }),
    );
    expect(String(provider)).toBe(
      "[ProductionConfiguredKeyEncryptionKeyProvider redacted]",
    );
    expect(inspect(provider)).not.toContain(recognizable.toString("base64"));
    expect(JSON.stringify(provider)).not.toContain(
      recognizable.toString("base64"),
    );
  });

  it("continues unwrapping v1 after v2 becomes active", async () => {
    const keys = {
      "kek-v1": Buffer.alloc(32, 1),
      "kek-v2": Buffer.alloc(32, 2),
    };
    const v1 = new ProductionConfiguredKeyEncryptionKeyProvider(
      "kek-v1",
      keyring(keys),
    );
    const dek = Buffer.alloc(32, 9);
    const oldEnvelope = await v1.wrapKey(dek, AAD);
    const v2 = new ProductionConfiguredKeyEncryptionKeyProvider(
      "kek-v2",
      keyring(keys),
    );
    const newEnvelope = await v2.wrapKey(dek, AAD);
    expect(oldEnvelope.keyVersion).toBe("kek-v1");
    expect(newEnvelope.keyVersion).toBe("kek-v2");
    await expect(v2.unwrapKey(oldEnvelope, AAD)).resolves.toEqual(dek);
    expect(oldEnvelope.keyVersion).toBe("kek-v1");
  });

  it("does not fall back when the recorded key version is unavailable", async () => {
    const v1 = new ProductionConfiguredKeyEncryptionKeyProvider(
      "kek-v1",
      keyring({ "kek-v1": Buffer.alloc(32, 1) }),
    );
    const wrapped = await v1.wrapKey(Buffer.alloc(32, 9), AAD);
    const onlyV2 = new ProductionConfiguredKeyEncryptionKeyProvider(
      "kek-v2",
      keyring({ "kek-v2": Buffer.alloc(32, 2) }),
    );
    await expect(onlyV2.unwrapKey(wrapped, AAD)).rejects.toThrow(
      "credential_key_version_unavailable",
    );
  });

  it("rejects malformed key material without exposing it", () => {
    const malformed = "recognizable-malformed-key";
    expect(
      () =>
        new ProductionConfiguredKeyEncryptionKeyProvider(
          "kek-v1",
          JSON.stringify({ "kek-v1": malformed }),
        ),
    ).toThrow("credential_kek_configuration_invalid");
  });

  it("forbids the development provider in production", () => {
    expect(
      () =>
        new DevelopmentStaticKeyEncryptionKeyProvider(
          "kek-v1",
          new Map([["kek-v1", Buffer.alloc(32, 1)]]),
          "production",
        ),
    ).toThrow("development_kek_forbidden");
  });
});
