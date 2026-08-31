export const CREDENTIAL_STORE = Symbol("CREDENTIAL_STORE");

export type CredentialLocator = string & {
  readonly __credentialLocator: unique symbol;
};

import type { CredentialProvider } from "@lcsp/contracts/github-integration";

export type CredentialStorageContext = {
  provider: CredentialProvider;
  providerCredentialId: string;
  ownerUserId: string;
  credentialVersion: number;
  envelopeVersion: number;
};

export const CREDENTIAL_STORE_HEALTH_STATUSES = {
  available: "AVAILABLE",
  unavailable: "UNAVAILABLE",
} as const;

export type CredentialStoreHealthStatus =
  (typeof CREDENTIAL_STORE_HEALTH_STATUSES)[keyof typeof CREDENTIAL_STORE_HEALTH_STATUSES];

export type CredentialStoreHealth = {
  status: CredentialStoreHealthStatus;
};

/** Stores encrypted values only and intentionally performs no actor authorization. */
export interface CredentialStorePort {
  store(
    secret: string,
    context: CredentialStorageContext,
  ): Promise<CredentialLocator>;
  read(credentialLocator: CredentialLocator): Promise<string>;
  replace(
    oldCredentialLocator: CredentialLocator,
    newSecret: string,
    context: CredentialStorageContext,
  ): Promise<CredentialLocator>;
  destroy(credentialLocator: CredentialLocator): Promise<void>;
  health(): Promise<CredentialStoreHealth>;
}
