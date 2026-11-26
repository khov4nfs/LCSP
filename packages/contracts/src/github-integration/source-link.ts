import { CREDENTIAL_PROVIDERS, type CredentialProvider } from "./statuses.ts";
import {
  parseAzureDevOpsRepositoryUrl,
  parseBitbucketRepositoryUrl,
  parseGitHubRepositoryUrl,
  parseGitLabRepositoryUrl,
} from "./repository-url.ts";

export type RepositorySourceLinkInput = {
  provider: CredentialProvider;
  canonicalRepositoryUrl: string;
  commitSha: string;
  path: string;
  startLine?: number | null;
  endLine?: number | null;
};

/**
 * Business purpose: Reconstruct a provider URL from a provider-validated durable repository identity for history display and evidence linking.
 * Business rules:
 * - Only the exact provider-specific full-name component count is accepted.
 * - Azure requires organization/project/repository and never uses a display name alone.
 * Execution flow:
 * 1. Validate each identity component.
 * 2. Build the provider URL using encoded path components.
 * 3. Round-trip through the shared provider parser and return only its canonical URL.
 * Failure cases:
 * - Missing, ambiguous, unsafe, or provider-mismatched names return null so callers retain internal evidence without an external link.
 * Side effects:
 * - Pure URL construction with no network access or persistence.
 */
export function buildCanonicalRepositoryUrl(
  provider: CredentialProvider,
  repositoryFullName: string,
): string | null {
  if (
    repositoryFullName.length === 0 ||
    repositoryFullName.length > 1024 ||
    /[\u0000-\u001f\u007f\\?#]/u.test(repositoryFullName)
  ) {
    return null;
  }

  const parts = repositoryFullName.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return null;

  let candidate: string;
  switch (provider) {
    case CREDENTIAL_PROVIDERS.github:
      if (parts.length !== 2) return null;
      candidate = `https://github.com/${parts.map(encodeURIComponent).join("/")}`;
      break;
    case CREDENTIAL_PROVIDERS.gitlab:
      if (parts.length < 2) return null;
      candidate = `https://gitlab.com/${parts.map(encodeURIComponent).join("/")}`;
      break;
    case CREDENTIAL_PROVIDERS.bitbucket:
      if (parts.length !== 2) return null;
      candidate = `https://bitbucket.org/${parts.map(encodeURIComponent).join("/")}`;
      break;
    case CREDENTIAL_PROVIDERS.azureDevOps:
      if (parts.length !== 3) return null;
      candidate = `https://dev.azure.com/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}/_git/${encodeURIComponent(parts[2])}`;
      break;
    default:
      return null;
  }

  const locator = parseForProvider(provider, candidate);
  return locator?.repositoryFullName === repositoryFullName
    ? locator.canonicalUrl
    : null;
}

/**
 * Business purpose: Build an external source citation that remains bound to the authorized repository and immutable assessment commit.
 * Business rules:
 * - The repository URL must be canonical for the supplied provider and the commit must be a full hexadecimal SHA.
 * - File paths and optional line ranges must be safe and internally consistent.
 * Execution flow:
 * 1. Validate provider URL, commit, path, and line range.
 * 2. Encode file path components.
 * 3. Apply the provider's pinned-file URL convention.
 * Failure cases:
 * - Incomplete provenance, traversal, malformed ranges, or provider mismatch returns null; internal evidence remains usable without an external link.
 * Side effects:
 * - Pure URL construction; no Agent-supplied external URL is accepted.
 */
export function buildRepositorySourceLink(
  input: RepositorySourceLinkInput,
): string | null {
  const locator = parseForProvider(input.provider, input.canonicalRepositoryUrl);
  if (
    !locator ||
    locator.canonicalUrl !== input.canonicalRepositoryUrl ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu.test(input.commitSha)
  ) {
    return null;
  }

  const pathParts = safeRepositoryPath(input.path);
  if (!pathParts) return null;
  const encodedPath = pathParts.map(encodeURIComponent).join("/");
  const hasStart = input.startLine !== undefined && input.startLine !== null;
  const hasEnd = input.endLine !== undefined && input.endLine !== null;
  if (hasStart !== hasEnd) return null;
  if (
    hasStart &&
    (!Number.isSafeInteger(input.startLine) ||
      !Number.isSafeInteger(input.endLine) ||
      (input.startLine as number) < 1 ||
      (input.endLine as number) < (input.startLine as number) ||
      (input.endLine as number) > 10_000_000)
  ) {
    return null;
  }

  const sha = input.commitSha.toLowerCase();
  switch (input.provider) {
    case CREDENTIAL_PROVIDERS.github:
      return `${locator.canonicalUrl}/blob/${sha}/${encodedPath}${hasStart ? `#L${input.startLine}-L${input.endLine}` : ""}`;
    case CREDENTIAL_PROVIDERS.gitlab:
      return `${locator.canonicalUrl}/-/blob/${sha}/${encodedPath}${hasStart ? `#L${input.startLine}-${input.endLine}` : ""}`;
    case CREDENTIAL_PROVIDERS.bitbucket: {
      const basename = pathParts[pathParts.length - 1];
      return `${locator.canonicalUrl}/src/${sha}/${encodedPath}?fileviewer=file-view-default${hasStart ? `#${encodeURIComponent(basename)}-${input.startLine}` : ""}`;
    }
    case CREDENTIAL_PROVIDERS.azureDevOps: {
      const target = new URL(locator.canonicalUrl);
      target.searchParams.set("path", `/${pathParts.join("/")}`);
      target.searchParams.set("version", `GC${sha}`);
      target.searchParams.set("_a", "contents");
      if (hasStart) {
        target.searchParams.set("line", String(input.startLine));
        target.searchParams.set("lineEnd", String(input.endLine));
        target.searchParams.set("lineStartColumn", "1");
        target.searchParams.set("lineEndColumn", "1");
      }
      return target.toString();
    }
    default:
      return null;
  }
}

/**
 * Business purpose: Dispatch a repository locator to the exact shared parser for its declared provider.
 * Business rules:
 * - Provider identity must match the selected parser; no provider fallback or host inference from evidence is allowed.
 * Execution flow:
 * 1. Select the parser by the provider discriminator.
 * 2. Return its validated locator or null.
 * Failure cases:
 * - Unsupported provider values or invalid URLs return null.
 * Side effects:
 * - Pure parser dispatch without network access or persistence.
 */
function parseForProvider(
  provider: CredentialProvider,
  value: unknown,
) {
  switch (provider) {
    case CREDENTIAL_PROVIDERS.github:
      return parseGitHubRepositoryUrl(value);
    case CREDENTIAL_PROVIDERS.gitlab:
      return parseGitLabRepositoryUrl(value);
    case CREDENTIAL_PROVIDERS.bitbucket:
      return parseBitbucketRepositoryUrl(value);
    case CREDENTIAL_PROVIDERS.azureDevOps:
      return parseAzureDevOpsRepositoryUrl(value);
    default:
      return null;
  }
}

/**
 * Business purpose: Validate and split a repository-relative source path before provider URL construction.
 * Business rules:
 * - Reject absolute paths, alternate separators, controls, traversal, and empty components.
 * Execution flow:
 * 1. Check size and forbidden path forms.
 * 2. Split by POSIX separators and return validated components.
 * Failure cases:
 * - Unsafe or ambiguous paths return null and cannot become external links.
 * Side effects:
 * - Pure path validation; no filesystem operation occurs.
 */
function safeRepositoryPath(value: string): string[] | null {
  if (
    value.length === 0 ||
    value.length > 4096 ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    /^[a-z]:/iu.test(value) ||
    /[\u0000-\u001f\u007f\\]/u.test(value)
  ) {
    return null;
  }
  const parts = value.split("/");
  return parts.some((part) => !part || part === "." || part === "..")
    ? null
    : parts;
}
