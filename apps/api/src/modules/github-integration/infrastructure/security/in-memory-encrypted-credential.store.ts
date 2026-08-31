import { randomUUID } from "node:crypto";

import {
  CREDENTIAL_STORE_HEALTH_STATUSES,
  type CredentialStorageContext,
  type CredentialStoreHealth,
  type CredentialStorePort,
  type CredentialLocator,
} from "../../application/ports/security/credential-store.port.js";
import {
  EnvelopeEncryptionError,
  EnvelopeEncryptionService,
  type EncryptedSecretEnvelope,
} from "./envelope-encryption.service.js";

type EncryptedCredentialRecord = {
  envelope: EncryptedSecretEnvelope;
  ownerUserId: string;
  context: CredentialStorageContext;
  createdAt: Date;
};

/** Stable, locator-free and secret-free credential-store failure. */
export class CredentialStoreError extends Error {
  readonly operation?: string;

  constructor(options?: { cause?: unknown; operation?: string }) {
    super("credential_store_operation_failed", { cause: options?.cause });
    this.name = "CredentialStoreError";
    this.operation = options?.operation;
  }
}

/**
 * Encrypted in-memory adapter for Phase 1 tests only.
 * Database persistence uses the same envelope representation on ProviderCredential.
 */
export class InMemoryEncryptedCredentialStore implements CredentialStorePort {
  private readonly records = new Map<
    CredentialLocator,
    EncryptedCredentialRecord
  >();

  constructor(private readonly encryption: EnvelopeEncryptionService) {}

  async store(
    secret: string,
    context: CredentialStorageContext,
  ): Promise<CredentialLocator> {
    try {
      const credentialLocator = randomUUID() as CredentialLocator;
      const envelope = await this.encryption.encryptSecret(secret, context);
      this.records.set(credentialLocator, {
        envelope,
        ownerUserId: context.ownerUserId,
        context,
        createdAt: new Date(),
      });
      return credentialLocator;
    } catch {
      throw new CredentialStoreError();
    }
  }

  async read(credentialLocator: CredentialLocator): Promise<string> {
    const record = this.records.get(credentialLocator);
    if (!record) {
      throw new CredentialStoreError();
    }
    try {
      return await this.encryption.decryptSecret(
        record.envelope,
        record.context,
      );
    } catch (error: unknown) {
      if (error instanceof EnvelopeEncryptionError) {
        throw new CredentialStoreError();
      }
      throw new CredentialStoreError();
    }
  }

  async replace(
    oldCredentialLocator: CredentialLocator,
    newSecret: string,
    context: CredentialStorageContext,
  ): Promise<CredentialLocator> {
    if (!this.records.has(oldCredentialLocator)) {
      throw new CredentialStoreError();
    }
    const newCredentialLocator = await this.store(newSecret, context);
    this.records.delete(oldCredentialLocator);
    return newCredentialLocator;
  }

  destroy(credentialLocator: CredentialLocator): Promise<void> {
    this.records.delete(credentialLocator);
    return Promise.resolve();
  }

  health(): Promise<CredentialStoreHealth> {
    return Promise.resolve({
      status: CREDENTIAL_STORE_HEALTH_STATUSES.available,
    });
  }
}
