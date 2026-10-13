const DEFAULT_JIRA_ORIGIN = "https://minhpnq1807.atlassian.net";

function configuredJiraOrigin() {
  const value = process.env.JIRA_BASE_URL || DEFAULT_JIRA_ORIGIN;
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "JIRA_BASE_URL must be an HTTPS origin without credentials or a path",
    );
  }
  return url.origin;
}

export function isAllowedJiraPageUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.origin === configuredJiraOrigin()
    );
  } catch {
    return false;
  }
}

export function findAllowedJiraPage(pages) {
  return pages.find(
    (page) => page?.type === "page" && isAllowedJiraPageUrl(page.url),
  );
}
