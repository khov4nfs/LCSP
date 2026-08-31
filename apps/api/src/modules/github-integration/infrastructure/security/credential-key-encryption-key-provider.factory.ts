import type { GithubCredentialPersistenceConfig } from "../../../../config/config.types.js";
import type { KeyEncryptionKeyProvider } from "../../application/ports/security/key-encryption-key-provider.port.js";
import { CredentialStorageDisabledKeyEncryptionKeyProvider } from "./credential-storage-disabled-key-encryption-key.provider.js";
import { ProductionConfiguredKeyEncryptionKeyProvider } from "./production-configured-key-encryption-key.provider.js";

export function createCredentialKeyEncryptionKeyProvider(
  config: GithubCredentialPersistenceConfig,
): KeyEncryptionKeyProvider {
  return config.enabled
    ? new ProductionConfiguredKeyEncryptionKeyProvider(
        config.activeKekVersion,
        config.encodedKekKeyring,
      )
    : new CredentialStorageDisabledKeyEncryptionKeyProvider();
}
