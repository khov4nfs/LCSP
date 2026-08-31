import {
  KEY_ENCRYPTION_KEY_PROVIDER_HEALTH_STATUSES,
  type KeyEncryptionKeyProvider,
  type KeyEncryptionKeyProviderHealth,
  type WrappedDataEncryptionKey,
} from "../../application/ports/security/key-encryption-key-provider.port.js";

export class CredentialStorageDisabledKeyEncryptionKeyProvider implements KeyEncryptionKeyProvider {
  wrapKey(): Promise<WrappedDataEncryptionKey> {
    return Promise.reject(new Error("credential_storage_disabled"));
  }
  unwrapKey(): Promise<Buffer> {
    return Promise.reject(new Error("credential_storage_disabled"));
  }
  health(): Promise<KeyEncryptionKeyProviderHealth> {
    return Promise.resolve({
      status: KEY_ENCRYPTION_KEY_PROVIDER_HEALTH_STATUSES.unavailable,
      activeKeyVersion: null,
    });
  }
}
