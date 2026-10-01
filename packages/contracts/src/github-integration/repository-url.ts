/** Shared by the web setup form and the API before any Assessment mutation. */
export type RepositoryUrlLocator = {
  repositoryFullName: string;
  canonicalUrl: string;
};

export const REPOSITORY_URL_MAX_LENGTH = 2048;

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
  return { repositoryFullName, canonicalUrl: `https://${hostname}/${repositoryFullName}` };
}

export function parseGitHubRepositoryUrl(value: unknown): RepositoryUrlLocator | null {
  return parseRepositoryUrl(value, "github.com", false);
}

export function parseGitLabRepositoryUrl(value: unknown): RepositoryUrlLocator | null {
  return parseRepositoryUrl(value, "gitlab.com", true);
}
