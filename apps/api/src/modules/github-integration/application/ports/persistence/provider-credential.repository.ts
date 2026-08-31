import type {
  CredentialProvider,
  GitHubCredentialErrorCode,
  ProviderCredentialStatus,
} from "@lcsp/contracts/github-integration";

export const PROVIDER_CREDENTIAL_REPOSITORY = Symbol(
  "PROVIDER_CREDENTIAL_REPOSITORY",
);

export type ProviderCredentialRecord = {
  id: string;
  provider: CredentialProvider;
  ownerUserId: string;
  providerAccountId: bigint;
  providerLogin: string;
  status: ProviderCredentialStatus;
  currentVersion: number;
  declaredExpiresAt: Date | null;
  validatedAt: Date | null;
};

export interface ProviderCredentialRepository {
  create(record: ProviderCredentialRecord): Promise<void>;
  findActiveByOwnerProvider(
    ownerUserId: string,
    provider: CredentialProvider,
  ): Promise<ProviderCredentialRecord | null>;
  updateForRotation(
    id: string,
    ownerUserId: string,
    expectedVersion: number,
    record: Omit<ProviderCredentialRecord, "id" | "currentVersion"> & {
      currentVersion: number;
    },
  ): Promise<boolean>;
  deactivateActive(
    ownerUserId: string,
    provider: CredentialProvider,
  ): Promise<void>;
  findByIdForOwner(
    id: string,
    ownerUserId: string,
  ): Promise<ProviderCredentialRecord | null>;
  updateLifecycle(
    id: string,
    ownerUserId: string,
    status: ProviderCredentialStatus,
    safeFailureCode?: GitHubCredentialErrorCode,
  ): Promise<boolean>;
  updateVersion(
    id: string,
    ownerUserId: string,
    expectedVersion: number,
    newVersion: number,
  ): Promise<boolean>;
  markValidated(id: string, ownerUserId: string, at: Date): Promise<boolean>;
  markUsed(
    id: string,
    ownerUserId: string,
    version: number,
    at: Date,
  ): Promise<boolean>;
}
