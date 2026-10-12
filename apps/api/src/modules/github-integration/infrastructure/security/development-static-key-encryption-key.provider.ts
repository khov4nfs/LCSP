import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { inspect } from "node:util";

import {
  KEY_ENCRYPTION_KEY_PROVIDER_HEALTH_STATUSES,
  type KeyEncryptionKeyProvider,
  type KeyEncryptionKeyProviderHealth,
  type WrappedDataEncryptionKey,
} from "../../application/ports/security/key-encryption-key-provider.port.js";

const GCM_NONCE_BYTES = 12;
const CUSTOM_INSPECT = inspect.custom;
const PROVIDER_REDACTION =
  "[DevelopmentStaticKeyEncryptionKeyProvider redacted]";

/**
 * Development/test KEK provider. Production must replace this with managed key custody.
 * It is intentionally not registered in any Nest module.
 */
export class DevelopmentStaticKeyEncryptionKeyProvider implements KeyEncryptionKeyProvider {
  readonly #keys: ReadonlyMap<string, Buffer>;
  readonly #activeKeyVersion: string;

  constructor(
    activeKeyVersion: string,
    keys: ReadonlyMap<string, Buffer>,
    runtimeEnvironment = process.env.NODE_ENV,
  ) {
    if (runtimeEnvironment === "production") {
      throw new Error("development_kek_forbidden");
    }
    this.#activeKeyVersion = activeKeyVersion;
    this.#keys = new Map(
      [...keys].map(([version, key]) => [version, Buffer.from(key)]),
    );
    if (this.#keys.get(activeKeyVersion)?.length !== 32) {
      throw new Error("development_kek_invalid");
    }
  }

  wrapKey(
    dataEncryptionKey: Buffer,
    additionalData?: Buffer,
  ): Promise<WrappedDataEncryptionKey> {
    const key = this.getConfiguredKey(this.#activeKeyVersion);
    const nonce = randomBytes(GCM_NONCE_BYTES);
    try {
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(
        keyWrappingAdditionalData(this.#activeKeyVersion, additionalData),
      );
      const ciphertext = Buffer.concat([
        cipher.update(dataEncryptionKey),
        cipher.final(),
      ]);
      return Promise.resolve({
        keyVersion: this.#activeKeyVersion,
        ciphertext: ciphertext.toString("base64"),
        nonce: nonce.toString("base64"),
        authenticationTag: cipher.getAuthTag().toString("base64"),
      });
    } catch {
      throw new Error("credential_key_wrap_failed");
    } finally {
      key.fill(0);
      nonce.fill(0);
    }
  }

  unwrapKey(
    wrappedKey: WrappedDataEncryptionKey,
    additionalData?: Buffer,
  ): Promise<Buffer> {
    const key = this.getConfiguredKey(wrappedKey.keyVersion);
    const nonce = decodeBase64(wrappedKey.nonce, GCM_NONCE_BYTES);
    const ciphertext = decodeBase64(wrappedKey.ciphertext);
    const authenticationTag = decodeBase64(wrappedKey.authenticationTag, 16);
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, nonce);
      decipher.setAAD(
        keyWrappingAdditionalData(wrappedKey.keyVersion, additionalData),
      );
      decipher.setAuthTag(authenticationTag);
      return Promise.resolve(
        Buffer.concat([decipher.update(ciphertext), decipher.final()]),
      );
    } catch {
      throw new Error("credential_key_unwrap_failed");
    } finally {
      key.fill(0);
      nonce.fill(0);
      ciphertext.fill(0);
      authenticationTag.fill(0);
    }
  }

  health(): Promise<KeyEncryptionKeyProviderHealth> {
    return Promise.resolve({
      status: KEY_ENCRYPTION_KEY_PROVIDER_HEALTH_STATUSES.available,
      activeKeyVersion: this.#activeKeyVersion,
    });
  }

  [CUSTOM_INSPECT](): string {
    return PROVIDER_REDACTION;
  }

  private getConfiguredKey(version: string): Buffer {
    const key = this.#keys.get(version);
    if (!key || key.length !== 32) {
      throw new Error("credential_key_version_unavailable");
    }
    return Buffer.from(key);
  }
}

function keyWrappingAdditionalData(
  keyVersion: string,
  additionalData?: Buffer,
): Buffer {
  return Buffer.concat([
    Buffer.from(`LCSP_CREDENTIAL_DEK:${keyVersion}\n`, "utf8"),
    additionalData ?? Buffer.alloc(0),
  ]);
}

function decodeBase64(value: string, expectedBytes?: number): Buffer {
  const decoded = Buffer.from(value, "base64");
  if (
    decoded.length === 0 ||
    (expectedBytes !== undefined && decoded.length !== expectedBytes) ||
    decoded.toString("base64") !== value
  ) {
    decoded.fill(0);
    throw new Error("credential_key_material_invalid");
  }
  return decoded;
}
