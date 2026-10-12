import type { GitHubArchiveRedirectValidationStatus } from "@lcsp/contracts/github-integration";
import type { CredentialProvider } from "@lcsp/contracts/github-integration";
import type { Readable } from "node:stream";

import type { CredentialLease } from "../security/credential-lease.js";

export const GITHUB_ARCHIVE_TRANSPORT = Symbol("GITHUB_ARCHIVE_TRANSPORT");
export const REPOSITORY_ARCHIVE_TRANSPORT_REGISTRY = Symbol(
  "REPOSITORY_ARCHIVE_TRANSPORT_REGISTRY",
);

export type GitHubArchiveTransportResult = {
  stream: Readable;
  contentType: string;
  redirectValidation: GitHubArchiveRedirectValidationStatus;
  validatedHost: string;
};

/** GitHub-specific exact-SHA archive transport; all control-plane operations remain on gh. */
export interface GitHubArchiveTransportPort {
  downloadArchive(input: {
    credentialLease: CredentialLease;
    /** Stable provider repository ID when available (required by GitLab archive API). */
    repositoryId?: string;
    repositoryFullName: string;
    commitSha: string;
    abortSignal?: AbortSignal;
  }): Promise<GitHubArchiveTransportResult>;
}

export type RepositoryArchiveTransportRegistry = {
  get(provider: CredentialProvider): GitHubArchiveTransportPort;
};
