import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { inspect } from "node:util";

import {
  KEY_ENCRYPTION_KEY_PROVIDER_HEALTH_STATUSES,
  type KeyEncryptionKeyProvider,
  type KeyEncryptionKeyProviderHealth,
  type WrappedDataEncryptionKey,
} from "../../application/ports/security/key-encryption-key-provider.port.js";

const REDACTION = "[ProductionConfiguredKeyEncryptionKeyProvider redacted]";
const NONCE_BYTES = 12;

export class ProductionConfiguredKeyEncryptionKeyProvider implements KeyEncryptionKeyProvider {
  readonly #activeVersion: string;
  readonly #keys: ReadonlyMap<string, Buffer>;

  constructor(activeVersion: string, encodedKeyring: string) {
    try {
      const parsed: unknown = JSON.parse(encodedKeyring);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error();
      const keys = new Map<string, Buffer>();
      for (const [version, encoded] of Object.entries(parsed)) {
        if (!version || /[\r\n]/u.test(version) || typeof encoded !== "string")
          throw new Error();
        const key = decodeBase64(encoded, 32);
        keys.set(version, key);
      }
      if (!activeVersion || !keys.has(activeVersion)) throw new Error();
      this.#activeVersion = activeVersion;
      this.#keys = keys;
    } catch {
      throw new Error("credential_kek_configuration_invalid");
    }
  }

  wrapKey(
    dataEncryptionKey: Buffer,
    additionalData?: Buffer,
  ): Promise<WrappedDataEncryptionKey> {
    const key = this.key(this.#activeVersion);
    const nonce = randomBytes(NONCE_BYTES);
    try {
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(wrappingAad(this.#activeVersion, additionalData));
      const ciphertext = Buffer.concat([
        cipher.update(dataEncryptionKey),
        cipher.final(),
      ]);
      return Promise.resolve({
        keyVersion: this.#activeVersion,
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
    let key: Buffer;
    try {
      key = this.key(wrappedKey.keyVersion);
    } catch {
      return Promise.reject(new Error("credential_key_version_unavailable"));
    }
    const nonce = decodeBase64(wrappedKey.nonce, NONCE_BYTES);
    const ciphertext = decodeBase64(wrappedKey.ciphertext);
    const tag = decodeBase64(wrappedKey.authenticationTag, 16);
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, nonce);
      decipher.setAAD(wrappingAad(wrappedKey.keyVersion, additionalData));
      decipher.setAuthTag(tag);
      return Promise.resolve(
        Buffer.concat([decipher.update(ciphertext), decipher.final()]),
      );
    } catch {
      throw new Error("credential_key_unwrap_failed");
    } finally {
      key.fill(0);
      nonce.fill(0);
      ciphertext.fill(0);
      tag.fill(0);
    }
  }

  health(): Promise<KeyEncryptionKeyProviderHealth> {
    return Promise.resolve({
      status: KEY_ENCRYPTION_KEY_PROVIDER_HEALTH_STATUSES.available,
      activeKeyVersion: this.#activeVersion,
    });
  }

  toString(): string {
    return REDACTION;
  }
  toJSON(): string {
    return REDACTION;
  }
  [inspect.custom](): string {
    return REDACTION;
  }

  private key(version: string): Buffer {
    const key = this.#keys.get(version);
    if (!key) throw new Error("credential_key_version_unavailable");
    return Buffer.from(key);
  }
}

function wrappingAad(version: string, additionalData?: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`LCSP_CREDENTIAL_DEK:${version}\n`, "utf8"),
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
