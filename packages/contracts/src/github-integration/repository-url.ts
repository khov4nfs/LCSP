/** Shared by the web setup form and the API before any Assessment mutation. */
export type RepositoryUrlLocator = {
  repositoryFullName: string;
  canonicalUrl: string;
};

export const REPOSITORY_URL_MAX_LENGTH = 2048;

const BITBUCKET_HOST = "bitbucket.org";
const AZURE_DEVOPS_HOST = "dev.azure.com";
const AZURE_VISUAL_STUDIO_SUFFIX = ".visualstudio.com";

/**
 * Business purpose: Parse the existing GitHub and GitLab repository URL forms into shared provider-neutral locators.
 * Business rules:
 * - Only HTTPS URLs on the exact provider hostname and with the expected repository path depth are accepted.
 * - The result is a locator only; provider access and repository authorization are validated separately.
 * Execution flow:
 * 1. Parse and constrain scheme, authority, query, and fragment.
 * 2. Normalize the supported trailing slash and `.git` suffix, then validate repository components.
 * Failure cases:
 * - Malformed URLs, unsupported hosts, unsafe authority values, and invalid repository paths return null.
 * Side effects:
 * - Pure parsing with no provider request or persistence.
 */
function parseRepositoryUrl(
  value: unknown,
  hostname: string,
  allowNestedGroups: boolean,
): RepositoryUrlLocator | null {
  if (typeof value !== "string") return null;
  const input = value.trim();
  if (!input || input.length > REPOSITORY_URL_MAX_LENGTH) return null;

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== hostname ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return null;
  }

  // Remove only one trailing slash. Never silently discard empty path segments.
  const pathname = url.pathname.replace(/\/$/u, "");
  if (pathname.includes("/-/")) return null;
  const parts = pathname.slice(1).split("/");
  if (
    parts.length < 2 ||
    (!allowNestedGroups && parts.length !== 2) ||
    parts.some((part) => part.length === 0)
  ) {
    return null;
  }
  const last = parts[parts.length - 1];
  parts[parts.length - 1] = last.endsWith(".git") ? last.slice(0, -4) : last;
  const repositoryFullName = parts.join("/");
  if (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/u.test(repositoryFullName)) {
    return null;
  }
  return {
    repositoryFullName,
    canonicalUrl: `https://${hostname}/${repositoryFullName}`,
  };
}

/**
 * Business purpose: Parse the existing GitHub direct-onboarding URL into its repository locator.
 * Business rules:
 * - Only a two-component repository path on github.com is accepted.
 * - URL parsing does not establish repository access or authorization.
 * Execution flow:
 * 1. Apply the shared GitHub/GitLab HTTPS and path validation rules with nested groups disabled.
 * 2. Return the validated repository name and canonical HTTPS URL, or null.
 * Failure cases:
 * - Invalid schemes, hosts, authorities, or repository paths return null.
 * Side effects:
 * - Pure parsing; no network request or persistence occurs.
 */
export function parseGitHubRepositoryUrl(
  value: unknown,
): RepositoryUrlLocator | null {
  return parseRepositoryUrl(value, "github.com", false);
}

/**
 * Business purpose: Parse the existing GitLab direct-onboarding URL into its namespaced project locator.
 * Business rules:
 * - Only a nested repository path on gitlab.com is accepted.
 * - URL parsing does not establish project access or authorization.
 * Execution flow:
 * 1. Apply the shared GitHub/GitLab HTTPS and path validation rules with nested groups enabled.
 * 2. Return the validated namespace path and canonical HTTPS URL, or null.
 * Failure cases:
 * - Invalid schemes, hosts, authorities, or namespaced project paths return null.
 * Side effects:
 * - Pure parsing; no network request or persistence occurs.
 */
export function parseGitLabRepositoryUrl(
  value: unknown,
): RepositoryUrlLocator | null {
  return parseRepositoryUrl(value, "gitlab.com", true);
}

/**
 * Parses a Bitbucket Cloud repository URL into a safe locator.
 *
 * Business purpose: Accept the Bitbucket Cloud URL form used for direct repository onboarding.
 * Business rules:
 * - Only HTTPS bitbucket.org workspace/repository locators are accepted.
 * - URL syntax cannot establish access or repository identity.
 * Execution flow:
 * 1. Validate raw authority and path text, then decode each segment once.
 * 2. Enforce the exact two-segment shape and canonicalize the optional .git suffix.
 * Failure cases:
 * - Invalid escapes, ambiguous separators, traversal, credentials, ports, query strings, fragments, and unsupported hosts return null.
 * Side effects:
 * - Pure parsing and normalization with no provider access or persistence.
 */
export function parseBitbucketRepositoryUrl(
  value: unknown,
): RepositoryUrlLocator | null {
  const parsed = parseStrictProviderUrl(value);
  if (!parsed || parsed.hostname !== BITBUCKET_HOST) return null;
  const segments = decodeSafePathSegments(parsed.rawPath);
  if (!segments || segments.length !== 2) return null;
  const [workspace, rawRepository] = segments;
  const repository = stripGitSuffix(rawRepository);
  if (
    !workspace ||
    !repository ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(workspace) ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(repository)
  ) {
    return null;
  }
  const repositoryFullName = `${workspace}/${repository}`;
  return {
    repositoryFullName,
    canonicalUrl: `https://${BITBUCKET_HOST}/${workspace}/${repository}`,
  };
}

/**
 * Parses supported Azure DevOps Services repository URLs as locators.
 *
 * Business purpose: Accept current dev.azure.com and legacy organization.visualstudio.com direct repository URLs.
 * Business rules:
 * - The URL must identify exactly one organization, project, and repository path.
 * - Parsing does not prove organization membership, repository identity, or authorization.
 * Execution flow:
 * 1. Validate the raw HTTPS authority and path, and decode safe segments once.
 * 2. Map the legacy host to canonical dev.azure.com and encode path components deterministically.
 * Failure cases:
 * - Invalid host/path shapes, traversal, encoded separators, double-encoding ambiguity, URL credentials, explicit ports, query strings, fragments, and malformed escapes return null.
 * Side effects:
 * - Pure parsing and normalization with no provider access or persistence.
 */
export function parseAzureDevOpsRepositoryUrl(
  value: unknown,
): RepositoryUrlLocator | null {
  const parsed = parseStrictProviderUrl(value);
  if (!parsed) return null;
  const isCurrentHost = parsed.hostname === AZURE_DEVOPS_HOST;
  const visualStudioOrg = getVisualStudioOrganization(parsed.hostname);
  if (!isCurrentHost && !visualStudioOrg) return null;

  const segments = decodeSafePathSegments(parsed.rawPath);
  if (!segments) return null;

  let organization: string;
  let project: string;
  let rawRepository: string;
  if (isCurrentHost) {
    if (segments.length !== 4 || segments[2] !== "_git") return null;
    [organization, project, , rawRepository] = segments;
  } else {
    if (
      !visualStudioOrg ||
      segments.length !== 3 ||
      segments[1] !== "_git"
    ) {
      return null;
    }
    organization = visualStudioOrg;
    [project, , rawRepository] = segments;
  }

  const repository = stripGitSuffix(rawRepository);
  if (
    !organization ||
    !/^[A-Za-z0-9][A-Za-z0-9.-]*$/u.test(organization) ||
    !project ||
    !repository
  ) {
    return null;
  }
  const repositoryFullName = `${organization}/${project}/${repository}`;
  return {
    repositoryFullName,
    canonicalUrl: [
      "https://dev.azure.com",
      encodeURIComponent(organization),
      encodeURIComponent(project),
      "_git",
      encodeURIComponent(repository),
    ].join("/"),
  };
}

/**
 * Business purpose: Establish a strict HTTPS URL boundary before general URL normalization can rewrite path syntax.
 * Business rules:
 * - Only an authority without credentials or explicit ports and a path without query/fragment syntax is eligible for provider parsing.
 * Execution flow:
 * 1. Validate raw text and authority, then parse the URL.
 * 2. Return its normalized hostname with the untouched raw path.
 * Failure cases:
 * - Invalid schemes, authorities, controls, backslashes, queries, fragments, ports, credentials, or malformed URLs return null.
 * Side effects:
 * - Pure input validation; no network request or persistence occurs.
 */
function parseStrictProviderUrl(
  value: unknown,
): { hostname: string; rawPath: string } | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > REPOSITORY_URL_MAX_LENGTH
  ) {
    return null;
  }
  const input = value.trim();
  if (!input || /[\u0000-\u001f\u007f]/u.test(input) || /[\\?#]/u.test(input)) {
    return null;
  }
  const authorityMatch = /^https:\/\/([^/]+)(\/[^?#]*)?$/iu.exec(input);
  if (!authorityMatch) return null;
  const authority = authorityMatch[1];
  const rawPath = authorityMatch[2] ?? "/";
  if (!authority || authority.includes("@") || authority.includes(":"))
    return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return null;
  }
  return { hostname: url.hostname, rawPath };
}

/**
 * Business purpose: Convert a provider URL path into unambiguous repository name components.
 * Business rules:
 * - Every component is decoded at most once.
 * - Encoded separators, traversal, controls, and second-decode ambiguity are rejected.
 * Execution flow:
 * 1. Validate percent escapes and decode each segment once.
 * 2. Validate the resulting component before adding it to the locator.
 * Failure cases:
 * - Any empty, malformed, traversing, ambiguous, or control-bearing component returns null.
 * Side effects:
 * - Pure parsing with no filesystem or provider access.
 */
function decodeSafePathSegments(rawPath: string): string[] | null {
  if (rawPath.includes("\\")) return null;
  let path = rawPath;
  if (path.endsWith("/")) path = path.slice(0, -1);
  if (!path.startsWith("/") || path === "/") return null;
  const rawSegments = path.slice(1).split("/");
  if (rawSegments.some((segment) => segment.length === 0)) return null;
  const decoded: string[] = [];
  for (const rawSegment of rawSegments) {
    if (/%(?![0-9a-f]{2})/iu.test(rawSegment)) return null;
    let segment: string;
    try {
      segment = decodeURIComponent(rawSegment);
    } catch {
      return null;
    }
    if (
      !segment ||
      segment === "." ||
      segment === ".." ||
      /[\/\\?#\u0000-\u001f\u007f]/u.test(segment) ||
      /%[0-9a-f]{2}/iu.test(segment)
    ) {
      return null;
    }
    decoded.push(segment);
  }
  return decoded;
}

/**
 * Business purpose: Normalize the provider's optional repository clone suffix for a repository locator.
 * Business rules:
 * - Exactly one terminal `.git` suffix is removed; no other path component is rewritten.
 * Execution flow:
 * 1. Inspect the terminal suffix and return the normalized repository component.
 * Failure cases:
 * - The caller must validate the component before using this helper.
 * Side effects:
 * - Pure string normalization.
 */
function stripGitSuffix(repository: string): string {
  return repository.endsWith(".git") ? repository.slice(0, -4) : repository;
}

/**
 * Business purpose: Resolve the organization component from Azure DevOps' supported legacy hostname.
 * Business rules:
 * - Only one simple organization label under visualstudio.com is accepted.
 * Execution flow:
 * 1. Verify the suffix, extract its single label, and validate the organization slug.
 * Failure cases:
 * - Additional subdomains, empty labels, and unsupported characters return null.
 * Side effects:
 * - Pure URL-host parsing.
 */
function getVisualStudioOrganization(hostname: string): string | null {
  if (!hostname.endsWith(AZURE_VISUAL_STUDIO_SUFFIX)) return null;
  const organization = hostname.slice(0, -AZURE_VISUAL_STUDIO_SUFFIX.length);
  if (
    !organization ||
    organization.includes(".") ||
    !/^[a-z0-9][a-z0-9-]*$/u.test(organization)
  ) {
    return null;
  }
  return organization;
}
