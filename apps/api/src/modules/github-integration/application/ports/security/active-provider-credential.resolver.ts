import type { CredentialProvider } from "@lcsp/contracts/github-integration";
import type { CredentialLease } from "../../security/credential-lease.js";

export type ActiveProviderCredentialMetadata = {
  id: string;
  provider: CredentialProvider;
  providerAccountId: string;
  providerLogin: string;
  currentVersion: number;
};

export type ResolvedActiveProviderCredential = {
  metadata: ActiveProviderCredentialMetadata;
  lease: CredentialLease;
};

export const ACTIVE_PROVIDER_CREDENTIAL_RESOLVER = Symbol(
  "ACTIVE_PROVIDER_CREDENTIAL_RESOLVER",
);

export interface ActiveProviderCredentialResolver {
  resolveActiveCredential(input: {
    userId: string;
    provider: CredentialProvider;
    repositoryFullName: string;
  }): Promise<ResolvedActiveProviderCredential>;
  findMetadata(input: {
    userId: string;
    provider: CredentialProvider;
  }): Promise<ActiveProviderCredentialMetadata | null>;
  resolveLease(input: {
    userId: string;
    provider: CredentialProvider;
    repositoryFullName: string;
  }): Promise<CredentialLease>;
}
