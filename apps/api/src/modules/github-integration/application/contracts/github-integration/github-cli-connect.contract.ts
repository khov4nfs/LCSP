export type GitHubRepositoryDiscoveryDto = {
  authenticated_account: { id: string; login: string };
  repositories: Array<{
    repository_id: string;
    name: string;
    full_name: string;
    default_branch: string;
    private: boolean;
  }>;
  next_cursor: string | null;
};

export type GitHubCliRepositoryConnectionDto = {
  connection_id: string;
  repository: {
    repository_id: string;
    name: string;
    full_name: string;
    default_branch: string;
    private: boolean;
  };
  authenticated_account: { id: string; login: string };
  connection_status: string;
  credential_status: string;
  declared_expires_at: string | null;
  connected_at: string;
};
