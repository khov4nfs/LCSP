/** One repository the customer has chosen but not yet saved on the server. */
export type RepositoryEntry = {
  provider: string;
  repositoryUrl: string;
  /** Repository-relative directory to assess; null assesses the whole repository. */
  sourcePathPrefix: string | null;
};

/** The form: a draft being typed plus the pending repositories collected so far. */
export type RepositorySetupFormValues = {
  provider?: string;
  repositoryUrl: string;
  repositories: RepositoryEntry[];
};

/** A repository already saved on the server (candidate or pinned), shaped for display. */
export type SavedRepositoryRow = {
  snapshotId: string | null;
  provider: string;
  repositoryFullName: string;
  /** Provider-validated canonical URL, when the API supplied one; used to reauthorize the connection. */
  canonicalRepositoryUrl?: string | null;
  sourcePathPrefix: string | null;
  commitSha: string | null;
  /** Pinned repositories can no longer be removed. */
  pinned: boolean;
};
