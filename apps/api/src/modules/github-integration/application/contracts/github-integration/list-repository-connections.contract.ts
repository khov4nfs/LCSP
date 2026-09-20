import type {
  CredentialProvider,
  RepositoryAuthenticationMode,
} from "@lcsp/contracts/github-integration";

export type RepositoryConnectionsSuccess = {
  ok: true;
  repositories: Array<{
    id: string;
    provider: CredentialProvider;
    authentication_mode: RepositoryAuthenticationMode;
    installation_id: string | null;
    repository_name: string;
    repository_full_name: string;
    default_branch: string;
    status: string;
    connected_at: string;
    revoked_at: string | null;
    assessment_id: string | null;
    assessment_name: string | null;
  }>;
};
