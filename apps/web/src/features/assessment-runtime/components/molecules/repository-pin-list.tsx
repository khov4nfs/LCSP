import type { RepositoryPinView } from "../../utils/repository-pins";
import { copy } from "../../utils/conversation-copy";

/**
 * Business purpose: List the repositories an assessment is pinned to, each with its commit and source scope, in the
 * compact form the context sidebar uses.
 * Business rules:
 * - One entry per pinned repository, in pin order; the commit is shortened for reading, never altered.
 * - A source prefix is shown only when the repository is scoped to a subtree.
 * Execution flow:
 * 1. Render each repository name, short commit and optional prefix.
 * Failure cases:
 * - Nothing renders for an empty list.
 * Side effects:
 * - None; presentation only.
 */
export function RepositoryPinList({
  repositories,
}: {
  repositories: readonly RepositoryPinView[];
}) {
  if (repositories.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2" data-slot="repository-pin-list">
      {repositories.map((repository) => (
        <li key={repository.repositoryKey ?? repository.fullName}>
          <span className="break-all font-mono text-xs font-semibold text-foreground">
            {repository.repositoryKey && repositories.length > 1
              ? `${repository.repositoryKey} · `
              : ""}
            {repository.fullName}
          </span>
          {repository.commit ? (
            <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">
              {copy("context.commit", {
                commit: repository.commit.slice(0, 7),
              })}
            </span>
          ) : null}
          {repository.sourcePathPrefix ? (
            <span className="block break-all font-mono text-[11px] text-muted-foreground">
              {repository.sourcePathPrefix}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
