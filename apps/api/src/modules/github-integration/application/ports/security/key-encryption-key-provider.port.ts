export const KEY_ENCRYPTION_KEY_PROVIDER = Symbol(
  "KEY_ENCRYPTION_KEY_PROVIDER",
);

export type WrappedDataEncryptionKey = {
  keyVersion: string;
  ciphertext: string;
  nonce: string;
  authenticationTag: string;
};

/** Wraps per-secret data-encryption keys without exposing KEK material. */
export interface KeyEncryptionKeyProvider {
  wrapKey(
    dataEncryptionKey: Buffer,
    additionalData?: Buffer,
  ): Promise<WrappedDataEncryptionKey>;
  unwrapKey(
    wrappedKey: WrappedDataEncryptionKey,
    additionalData?: Buffer,
  ): Promise<Buffer>;
  health(): Promise<KeyEncryptionKeyProviderHealth>;
}

export const KEY_ENCRYPTION_KEY_PROVIDER_HEALTH_STATUSES = {
  available: "AVAILABLE",
  unavailable: "UNAVAILABLE",
} as const;

export type KeyEncryptionKeyProviderHealthStatus =
  (typeof KEY_ENCRYPTION_KEY_PROVIDER_HEALTH_STATUSES)[keyof typeof KEY_ENCRYPTION_KEY_PROVIDER_HEALTH_STATUSES];

export type KeyEncryptionKeyProviderHealth = {
  status: KeyEncryptionKeyProviderHealthStatus;
  activeKeyVersion: string | null;
};
