import type { AssessmentRepositorySetup } from "@lcsp/contracts/assessment-domain";

/** One repository of the assessment as the runtime screens show it. */
export type RepositoryPinView = {
  repositoryKey: string | null;
  fullName: string;
  commit: string | null;
  sourcePathPrefix: string | null;
};

/**
 * Business purpose: Give every runtime screen the same list of repositories the assessment is pinned to, so the
 * sidebar, the opening message and the provenance view cannot disagree about which code was assessed.
 * Business rules:
 * - The server's repository list is authoritative and keeps pin order; an assessment saved before sets existed is a list of one.
 * - A repository without a saved connection cannot be named and is not listed.
 * - The commit comes from the repository's own snapshot, falling back to the case's primary commit only for the first (primary) repository.
 * Execution flow:
 * 1. Prefer the repository list of the setup view; otherwise use its primary connection.
 * 2. Project each entry to its name, commit and source prefix.
 * Failure cases:
 * - An absent setup view yields an empty list rather than an invented repository.
 * Side effects:
 * - None; pure projection.
 */
export function repositoryPinViews(
  setup: AssessmentRepositorySetup | null | undefined,
  primaryCommit: string | null = null,
): RepositoryPinView[] {
  if (!setup) return [];
  const entries =
    setup.repositories.length > 0
      ? setup.repositories
      : setup.connection
        ? [
            {
              repositoryKey: null,
              connection: setup.connection,
              snapshot: setup.snapshot,
              scanJob: setup.scanJob,
            },
          ]
        : [];
  return entries.map((entry, index) => ({
    repositoryKey: entry.repositoryKey,
    fullName: entry.connection.repositoryFullName,
    commit:
      entry.snapshot?.commitSha ?? (index === 0 ? primaryCommit : null) ?? null,
    sourcePathPrefix: entry.snapshot?.sourcePathPrefix ?? null,
  }));
}
