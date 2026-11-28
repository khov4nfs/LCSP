import { ASSESSMENT_REPOSITORY_PROVIDERS } from "@lcsp/contracts/assessment";
import {
  buildCanonicalRepositoryUrl,
  parseAzureDevOpsRepositoryUrl,
  parseBitbucketRepositoryUrl,
  parseGitHubRepositoryUrl,
  parseGitLabRepositoryUrl,
} from "@lcsp/contracts/github-integration";

import { GIT_PROVIDER_OPTIONS } from "../config/git-provider-options";

import type { RepositoryEntry } from "../types/repository-setup.types";

/**
 * Business purpose: Name the repository a customer typed so the list, duplicate checks and the assessment name
 * all agree on which repository an entry is.
 * Business rules:
 * - Every supported provider (GitHub, GitLab, Bitbucket, Azure DevOps) resolves; the full name comes from the shared URL parsers, never from ad hoc splitting.
 * Execution flow:
 * 1. Pick the parser for the entry provider.
 * 2. Return the parsed full name, or null when the URL does not belong to that provider.
 * Failure cases:
 * - Returns null for an unsupported provider or an invalid URL; the form schema reports those separately.
 * Side effects:
 * - None; pure parsing.
 */
export function repositoryFullNameOf(
  entry: Pick<RepositoryEntry, "provider" | "repositoryUrl">,
): string | null {
  switch (entry.provider) {
    case ASSESSMENT_REPOSITORY_PROVIDERS.github:
      return (
        parseGitHubRepositoryUrl(entry.repositoryUrl)?.repositoryFullName ??
        null
      );
    case ASSESSMENT_REPOSITORY_PROVIDERS.gitlab:
      return (
        parseGitLabRepositoryUrl(entry.repositoryUrl)?.repositoryFullName ??
        null
      );
    case ASSESSMENT_REPOSITORY_PROVIDERS.bitbucket:
      return (
        parseBitbucketRepositoryUrl(entry.repositoryUrl)?.repositoryFullName ??
        null
      );
    case ASSESSMENT_REPOSITORY_PROVIDERS.azureDevOps:
      return (
        parseAzureDevOpsRepositoryUrl(entry.repositoryUrl)
          ?.repositoryFullName ?? null
      );
    default:
      return null;
  }
}

/**
 * Business purpose: Decide whether two chosen repositories are the same thing, so one repository is never
 * assessed twice with the same scope while a monorepo may still be chosen once per directory.
 * Business rules:
 * - Identity is provider, repository full name and source directory; GitHub names ignore letter case.
 * Execution flow:
 * 1. Resolve the full name and normalise it.
 * 2. Join it with provider and scope.
 * Failure cases:
 * - An entry whose URL cannot be parsed has no identity (null) and never counts as a duplicate.
 * Side effects:
 * - None; pure computation.
 */
export function repositoryIdentityOf(entry: {
  provider: string;
  repositoryFullName: string | null;
  sourcePathPrefix: string | null;
}): string | null {
  if (!entry.repositoryFullName) return null;
  const name =
    entry.provider === ASSESSMENT_REPOSITORY_PROVIDERS.github
      ? entry.repositoryFullName.toLowerCase()
      : entry.repositoryFullName;
  return `${entry.provider}|${name}|${entry.sourcePathPrefix ?? ""}`;
}

/**
 * Business purpose: Give a new assessment a recognisable default name from the repositories it covers.
 * Business rules:
 * - The first repository names the assessment; more repositories are summarised by a localised plus-N suffix.
 * Execution flow:
 * 1. Take the first full name.
 * 2. Append the localised suffix when more repositories follow.
 * Failure cases:
 * - Returns an empty string when no repository name can be resolved.
 * Side effects:
 * - None; the caller supplies the localised formatter.
 */
export function assessmentNameFromRepositories(
  fullNames: readonly string[],
  formatMore: (name: string, count: number) => string,
): string {
  const [first, ...rest] = fullNames;
  if (!first) return "";
  return rest.length > 0 ? formatMore(first, rest.length) : first;
}

/**
 * Business purpose: Reconstruct a saved repository as an editable entry using the provider's canonical URL, so a
 * resumed setup shows the exact repository that was connected.
 * Business rules:
 * - A saved provider and repository identity must be supported and unambiguous.
 * - Azure DevOps URLs keep their organization/project/_git/repository structure.
 * Execution flow:
 * 1. Match the persisted provider against the supported provider options.
 * 2. Prefer the API-validated canonical URL; otherwise rebuild it from the provider and full name.
 * Failure cases:
 * - Missing or ambiguous identity returns null so the UI never guesses or submits a different repository.
 * Side effects:
 * - Pure projection with no repository or assessment mutation.
 */
export function deriveRepositoryEntryAnswer(
  repository: {
    provider?: string | null;
    repositoryFullName: string | null;
    canonicalRepositoryUrl?: string | null;
  } | null,
): { provider: string; repositoryUrl: string } | null {
  const provider = GIT_PROVIDER_OPTIONS.find(
    (option) => option.id === repository?.provider,
  );
  if (!provider || !repository?.repositoryFullName) return null;
  const repositoryUrl =
    repository.canonicalRepositoryUrl ??
    buildCanonicalRepositoryUrl(provider.id, repository.repositoryFullName);
  return repositoryUrl ? { provider: provider.id, repositoryUrl } : null;
}

/**
 * Business purpose: Show a repository by its recognisable tail so labels stay short for every provider.
 * Business rules:
 * - GitHub, GitLab and Bitbucket names are shown whole when they have two parts; Azure DevOps keeps project and
 *   repository and drops the organization.
 * Execution flow:
 * 1. Split the full name on slashes and keep its last two parts.
 * Failure cases:
 * - A name without a slash is returned unchanged.
 * Side effects:
 * - None; pure formatting.
 */
export function repositoryDisplayName(fullName: string): string {
  return fullName.split("/").slice(-2).join("/");
}
