import type {
  AzureDevOpsOrganizationPatCredential,
  BitbucketApiTokenCredential,
} from "@lcsp/contracts/github-integration";

export class ProviderCredentialRequest {
  provider!: string;
  /** Bitbucket and Azure submissions use provider-specific typed JSON credential contracts. */
  credential!:
    string | BitbucketApiTokenCredential | AzureDevOpsOrganizationPatCredential;
  /** Optional user-declared expiry, persisted only after provider validation succeeds. */
  credential_expires_at?: string;
}
