import {
  buildRepositorySourceLink,
  type CredentialProvider,
} from "@lcsp/contracts/github-integration";

export type RepositoryReportSource = {
  provider: CredentialProvider;
  canonicalRepositoryUrl: string;
  commitSha: string;
};

/**
 * Business purpose: Render a report source locator as a provider-correct link only when pinned repository provenance is complete.
 * Business rules: The locator must contain a safe repository-relative path and ordered positive line range; URL identity comes only from the authorized report snapshot context.
 * Execution flow: 1. Parse the final `:start-end` range. 2. Build a provider-specific pinned link. 3. Escape the generated URL and visible locator before rendering an anchor.
 * Failure cases: Missing provenance, unsafe paths, or malformed line ranges remain plain escaped locator text with no external URL.
 * Side effects: Pure HTML construction; no Agent-provided URL, network request, or persistence is used.
 */
export function renderReportSourceLocator(
  locator: string,
  source: RepositoryReportSource | null | undefined,
): string {
  const escapedLocator = escapeHtml(locator);
  if (!source) return `<code>${escapedLocator}</code>`;
  const match = /^(.+):([1-9]\d*)-([1-9]\d*)$/u.exec(locator);
  if (!match) return `<code>${escapedLocator}</code>`;
  const [, path, startLineText, endLineText] = match;
  const href = buildRepositorySourceLink({
    ...source,
    path,
    startLine: Number(startLineText),
    endLine: Number(endLineText),
  });
  return href
    ? `<a href="${escapeHtml(href)}" rel="noopener noreferrer"><code>${escapedLocator}</code></a>`
    : `<code>${escapedLocator}</code>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
