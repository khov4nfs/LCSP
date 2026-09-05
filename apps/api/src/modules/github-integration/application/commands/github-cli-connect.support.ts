import { HttpStatus } from "@nestjs/common";
import {
  GITHUB_CREDENTIAL_ERROR_CODES,
  GITHUB_INTEGRATION_ERROR_CODES,
  type GitHubCredentialErrorCode,
} from "@lcsp/contracts/github-integration";

import { problemException } from "../../../../platform/problems/problem-factory.js";
import { GitHubCliProviderError } from "../../infrastructure/github/github-cli-repository.provider.js";
import { GitLabCliProviderError } from "../../infrastructure/gitlab/gitlab-cli-repository.provider.js";
import { BitbucketCliProviderError } from "../../infrastructure/bitbucket/bitbucket-cli-repository.provider.js";
import { AzureDevOpsCliProviderError } from "../../infrastructure/azure-devops/azure-devops-cli-repository.provider.js";

export const GITHUB_CREDENTIAL_MIN_LENGTH = 20;
export const GITHUB_CREDENTIAL_MAX_LENGTH = 2048;
export const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
export const GITLAB_REPOSITORY_PATTERN =
  /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/u;
export const BITBUCKET_REPOSITORY_PATTERN =
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
export const AZURE_DEVOPS_REPOSITORY_PATTERN =
  /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/u;

export type GitHubRepositoryLocator = {
  repositoryFullName: string;
  canonicalUrl: string;
};

export type GitLabRepositoryLocator = GitHubRepositoryLocator;
export type BitbucketRepositoryLocator = GitHubRepositoryLocator;
export type AzureDevOpsRepositoryLocator = GitHubRepositoryLocator;

/** Parses only safe HTTPS GitHub repository URLs accepted by the connect flow. */
export function parseGitHubRepositoryUrl(
  value: unknown,
): GitHubRepositoryLocator | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return null;
  }
  const pathname = url.pathname.replace(/\/$/u, "");
  if (pathname.includes("/-/")) return null;
  const parts = pathname.slice(1).split("/");
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    return null;
  }
  const repository = parts[1].endsWith(".git")
    ? `${parts[0]}/${parts[1].slice(0, -4)}`
    : `${parts[0]}/${parts[1]}`;
  if (!GITHUB_REPOSITORY_PATTERN.test(repository)) return null;
  return {
    repositoryFullName: repository,
    canonicalUrl: `https://github.com/${repository}`,
  };
}

/** Parses GitLab.com URLs, including nested group paths. */
export function parseGitLabRepositoryUrl(
  value: unknown,
): GitLabRepositoryLocator | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "gitlab.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return null;
  }
  const pathname = url.pathname.replace(/\/$/u, "");
  if (pathname.includes("/-/")) return null;
  const parts = pathname.slice(1).split("/");
  if (parts.length < 2 || parts.some((part) => part.length === 0)) return null;
  const last = parts.at(-1) as string;
  parts[parts.length - 1] = last.endsWith(".git") ? last.slice(0, -4) : last;
  const repository = parts.join("/");
  if (!GITLAB_REPOSITORY_PATTERN.test(repository)) return null;
  return {
    repositoryFullName: repository,
    canonicalUrl: `https://gitlab.com/${repository}`,
  };
}

/** Parses Bitbucket.org URLs (workspace/repo-slug). */
export function parseBitbucketRepositoryUrl(
  value: unknown,
): BitbucketRepositoryLocator | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "bitbucket.org" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return null;
  }
  const pathname = url.pathname.replace(/\/$/u, "");
  if (pathname.includes("/src/") || pathname.includes("/commits/")) return null;
  const parts = pathname.slice(1).split("/");
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    return null;
  }
  const repository = parts[1].endsWith(".git")
    ? `${parts[0]}/${parts[1].slice(0, -4)}`
    : `${parts[0]}/${parts[1]}`;
  if (!BITBUCKET_REPOSITORY_PATTERN.test(repository)) return null;
  return {
    repositoryFullName: repository,
    canonicalUrl: `https://bitbucket.org/${repository}`,
  };
}

/** Parses Azure DevOps URLs (dev.azure.com or *.visualstudio.com). */
export function parseAzureDevOpsRepositoryUrl(
  value: unknown,
): AzureDevOpsRepositoryLocator | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return null;
  }
  const isDevAzure = url.hostname === "dev.azure.com";
  const isVisualStudio =
    url.hostname.endsWith(".visualstudio.com") &&
    url.hostname.split(".").length === 3;
  if (!isDevAzure && !isVisualStudio) return null;

  const pathname = url.pathname.replace(/\/$/u, "");
  if (!pathname.includes("/_git/")) return null;
  const segments = pathname.split("/_git/");
  if (segments.length !== 2) return null;
  const preGit = segments[0].slice(1).split("/").filter(Boolean);
  let repo = segments[1].replace(/\/$/u, "");
  if (!repo || repo.includes("/")) return null;
  if (repo.endsWith(".git")) repo = repo.slice(0, -4);

  let org: string;
  let project: string;
  if (isDevAzure) {
    if (preGit.length !== 2) return null;
    [org, project] = preGit;
  } else {
    org = url.hostname.split(".")[0];
    if (preGit.length !== 1) return null;
    project = preGit[0];
  }

  const repositoryFullName = `${org}/${project}/${repo}`;
  if (!AZURE_DEVOPS_REPOSITORY_PATTERN.test(repositoryFullName)) return null;

  return {
    repositoryFullName,
    canonicalUrl: `https://dev.azure.com/${org}/${project}/_git/${repo}`,
  };
}

export function assertCredential(
  value: unknown,
  correlationId: string,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length < GITHUB_CREDENTIAL_MIN_LENGTH ||
    value.length > GITHUB_CREDENTIAL_MAX_LENGTH ||
    /[\r\n\0]/u.test(value)
  ) {
    throw problemException(
      GITHUB_INTEGRATION_ERROR_CODES.credentialRequestInvalid,
      correlationId,
      { status: HttpStatus.BAD_REQUEST },
    );
  }
}

export function mapProviderFailure(
  error: unknown,
  correlationId: string,
): never {
  const category =
    error instanceof GitHubCliProviderError ||
    error instanceof GitLabCliProviderError ||
    error instanceof BitbucketCliProviderError ||
    error instanceof AzureDevOpsCliProviderError
      ? error.category
      : GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid;
  throw problemException(category, correlationId, {
    status: providerStatus(category),
  });
}

function providerStatus(category: GitHubCredentialErrorCode): number {
  const statuses: Record<GitHubCredentialErrorCode, number> = {
    [GITHUB_CREDENTIAL_ERROR_CODES.credentialRequired]: HttpStatus.BAD_REQUEST,
    [GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid]: HttpStatus.UNAUTHORIZED,
    [GITHUB_CREDENTIAL_ERROR_CODES.credentialExpired]: HttpStatus.UNAUTHORIZED,
    [GITHUB_CREDENTIAL_ERROR_CODES.credentialApprovalRequired]:
      HttpStatus.FORBIDDEN,
    [GITHUB_CREDENTIAL_ERROR_CODES.repositoryAccessDenied]:
      HttpStatus.NOT_FOUND,
    [GITHUB_CREDENTIAL_ERROR_CODES.repositoryUnavailable]: HttpStatus.NOT_FOUND,
    [GITHUB_CREDENTIAL_ERROR_CODES.providerRateLimited]:
      HttpStatus.TOO_MANY_REQUESTS,
    [GITHUB_CREDENTIAL_ERROR_CODES.providerTimeout]: HttpStatus.GATEWAY_TIMEOUT,
    [GITHUB_CREDENTIAL_ERROR_CODES.operationCancelled]: 499,
    [GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable]:
      HttpStatus.SERVICE_UNAVAILABLE,
    [GITHUB_CREDENTIAL_ERROR_CODES.providerResponseInvalid]:
      HttpStatus.BAD_GATEWAY,
  };
  return statuses[category];
}
