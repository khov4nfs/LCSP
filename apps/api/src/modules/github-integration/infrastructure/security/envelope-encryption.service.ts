import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import {
  KEY_ENCRYPTION_KEY_PROVIDER,
  type KeyEncryptionKeyProvider,
  type WrappedDataEncryptionKey,
} from "../../application/ports/security/key-encryption-key-provider.port.js";
import type { CredentialStorageContext } from "../../application/ports/security/credential-store.port.js";
import {
  CREDENTIAL_ENVELOPE_AAD_LAYERS,
  encodeCredentialEnvelopeAad,
} from "./credential-envelope-aad.js";

const ENVELOPE_ALGORITHM = "AES_256_GCM";
const ENVELOPE_VERSION = 1;
const AES_KEY_BYTES = 32;
const GCM_NONCE_BYTES = 12;

export type EncryptedSecretEnvelope = {
  algorithm: typeof ENVELOPE_ALGORITHM;
  version: typeof ENVELOPE_VERSION;
  ciphertext: string;
  nonce: string;
  authenticationTag: string;
  wrappedDataEncryptionKey: WrappedDataEncryptionKey;
};

/** Stable, secret-free envelope-crypto failure. */
export class EnvelopeEncryptionError extends Error {
  readonly reason?: string;

  constructor(options?: { cause?: unknown; reason?: string }) {
    super("credential_encryption_failed", { cause: options?.cause });
    this.name = "EnvelopeEncryptionError";
    this.reason = options?.reason;
  }
}

/** Encrypts credential values with a fresh DEK and delegates KEK wrapping to a provider. */
@Injectable()
export class EnvelopeEncryptionService {
  constructor(
    @Inject(KEY_ENCRYPTION_KEY_PROVIDER)
    private readonly keyProvider: KeyEncryptionKeyProvider,
  ) {}

  async encryptSecret(
    secret: string,
    context?: CredentialStorageContext,
  ): Promise<EncryptedSecretEnvelope> {
    const plaintext = Buffer.from(secret, "utf8");
    const dataEncryptionKey = randomBytes(AES_KEY_BYTES);
    const nonce = randomBytes(GCM_NONCE_BYTES);

    try {
      const cipher = createCipheriv("aes-256-gcm", dataEncryptionKey, nonce);
      cipher.setAAD(envelopeAdditionalData(context));
      const ciphertext = Buffer.concat([
        cipher.update(plaintext),
        cipher.final(),
      ]);
      const authenticationTag = cipher.getAuthTag();
      const wrappedDataEncryptionKey = await this.keyProvider.wrapKey(
        dataEncryptionKey,
        wrappingAdditionalData(context),
      );

      return {
        algorithm: ENVELOPE_ALGORITHM,
        version: ENVELOPE_VERSION,
        ciphertext: ciphertext.toString("base64"),
        nonce: nonce.toString("base64"),
        authenticationTag: authenticationTag.toString("base64"),
        wrappedDataEncryptionKey,
      };
    } catch (error: unknown) {
      if (error instanceof EnvelopeEncryptionError) throw error;
      throw new EnvelopeEncryptionError({
        cause: error,
        reason: safeEncryptionReason(error),
      });
    } finally {
      plaintext.fill(0);
      dataEncryptionKey.fill(0);
      nonce.fill(0);
    }
  }

  async decryptSecret(
    envelope: EncryptedSecretEnvelope,
    context?: CredentialStorageContext,
  ): Promise<string> {
    let dataEncryptionKey: Buffer | null = null;
    let plaintext: Buffer | null = null;
    let nonce: Buffer | null = null;
    let ciphertext: Buffer | null = null;
    let authenticationTag: Buffer | null = null;

    try {
      assertEnvelopeMetadata(envelope);
      dataEncryptionKey = await this.keyProvider.unwrapKey(
        envelope.wrappedDataEncryptionKey,
        wrappingAdditionalData(context),
      );
      if (dataEncryptionKey.length !== AES_KEY_BYTES) {
        throw new EnvelopeEncryptionError();
      }
      nonce = decodeBase64(envelope.nonce, GCM_NONCE_BYTES);
      ciphertext = decodeBase64(envelope.ciphertext);
      authenticationTag = decodeBase64(envelope.authenticationTag, 16);
      const decipher = createDecipheriv(
        "aes-256-gcm",
        dataEncryptionKey,
        nonce,
      );
      decipher.setAAD(envelopeAdditionalData(context));
      decipher.setAuthTag(authenticationTag);
      plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
      return plaintext.toString("utf8");
    } catch (error: unknown) {
      if (error instanceof EnvelopeEncryptionError) throw error;
      throw new EnvelopeEncryptionError({
        cause: error,
        reason: safeEncryptionReason(error),
      });
    } finally {
      dataEncryptionKey?.fill(0);
      plaintext?.fill(0);
      nonce?.fill(0);
      ciphertext?.fill(0);
      authenticationTag?.fill(0);
    }
  }
}

function envelopeAdditionalData(context?: CredentialStorageContext): Buffer {
  if (context)
    return encodeCredentialEnvelopeAad(
      context,
      CREDENTIAL_ENVELOPE_AAD_LAYERS.credential,
    );
  return Buffer.from(`${ENVELOPE_ALGORITHM}:${ENVELOPE_VERSION}`, "utf8");
}

function wrappingAdditionalData(
  context?: CredentialStorageContext,
): Buffer | undefined {
  return context
    ? encodeCredentialEnvelopeAad(
        context,
        CREDENTIAL_ENVELOPE_AAD_LAYERS.dekWrap,
      )
    : undefined;
}

function assertEnvelopeMetadata(envelope: EncryptedSecretEnvelope): void {
  if (
    envelope.algorithm !== ENVELOPE_ALGORITHM ||
    envelope.version !== ENVELOPE_VERSION
  ) {
    throw new EnvelopeEncryptionError();
  }
}

function decodeBase64(value: string, expectedBytes?: number): Buffer {
  const decoded = Buffer.from(value, "base64");
  if (
    decoded.length === 0 ||
    (expectedBytes !== undefined && decoded.length !== expectedBytes) ||
    decoded.toString("base64") !== value
  ) {
    decoded.fill(0);
    throw new EnvelopeEncryptionError();
  }
  return decoded;
}

function safeEncryptionReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (
    message === "credential_key_version_unavailable" ||
    message === "credential_key_material_invalid" ||
    message === "credential_key_wrap_failed" ||
    message === "credential_key_unwrap_failed"
  ) {
    return message;
  }
  return "crypto_operation_failed";
}
