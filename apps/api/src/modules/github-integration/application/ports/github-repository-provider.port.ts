import type { GitHubArchiveRedirectValidationStatus } from "@lcsp/contracts/github-integration";
import type { CredentialProvider } from "@lcsp/contracts/github-integration";

import type { CredentialLease } from "../security/credential-lease.js";

export const GITHUB_REPOSITORY_PROVIDER = Symbol("GITHUB_REPOSITORY_PROVIDER");
export const REPOSITORY_PROVIDER_REGISTRY = Symbol(
  "REPOSITORY_PROVIDER_REGISTRY",
);

export type GitHubIdentity = {
  id: string;
  login: string;
  htmlUrl: string;
};

export type GitHubRepositorySummary = {
  id: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
};

export type GitHubRepositoryMetadata = GitHubRepositorySummary;

export type GitHubRepositoryPagePolicy = {
  perPage: number;
  maxPages: number;
  maxRepositories: number;
  startPage?: number;
};

export type GitHubResolvedCommit = {
  sha: string;
  repositoryFullName: string;
  htmlUrl: string;
  authorDate: string | null;
  committerDate: string | null;
};

export type RepositoryProviderAdapter = GitHubRepositoryProviderPort;

export type RepositoryProviderRegistry = {
  get(provider: CredentialProvider): RepositoryProviderAdapter;
};

export type GitHubArchiveStream = {
  stream: NodeJS.ReadableStream;
  contentType: string;
  repositoryFullName: string;
  commitSha: string;
  finalRedirectHostValidation: GitHubArchiveRedirectValidationStatus;
};

/** GitHub-specific application boundary for the CLI-only MVP. */
export interface GitHubRepositoryProviderPort {
  validateIdentity(credential: CredentialLease): Promise<GitHubIdentity>;
  listAccessibleRepositories(
    credential: CredentialLease,
    pagePolicy: GitHubRepositoryPagePolicy,
  ): Promise<GitHubRepositorySummary[]>;
  validateRepositoryAccess(
    credential: CredentialLease,
    repositoryFullName: string,
    allowCanonicalRename?: boolean,
  ): Promise<GitHubRepositoryMetadata>;
  resolveCommit(
    credential: CredentialLease,
    repositoryFullName: string,
    revision: string,
  ): Promise<GitHubResolvedCommit>;
  downloadArchive(
    credential: CredentialLease,
    repositoryFullName: string,
    commitSha: string,
    abortSignal?: AbortSignal,
  ): Promise<GitHubArchiveStream>;
}
