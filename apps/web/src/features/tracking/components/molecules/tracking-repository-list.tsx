import type { CustomerTrackingAssessmentItem } from "@lcsp/contracts/assessment-domain";

import { trackingMessage } from "../../utils/tracking-display";
import { TrackingFreshnessBadge } from "./tracking-status-badge";

/**
 * Business purpose: Show how up to date each repository of an assessment is, so a stale repository is not hidden
 * behind the one displayed in the card header.
 * Business rules:
 * - One entry per pinned repository in pin order, each with its own assessed commit, latest observed commit and freshness.
 * - Nothing is shown when the assessment pins a single repository; the card already shows its commits.
 * Execution flow:
 * 1. Render each repository name with its freshness badge and short commits.
 * Failure cases:
 * - A repository without a known newer commit shows only its assessed commit.
 * Side effects:
 * - None; presentation only.
 */
export function TrackingRepositoryList({
  repositories,
}: {
  repositories: CustomerTrackingAssessmentItem["repositories"];
}) {
  if (repositories.length < 2) return null;
  return (
    <ul
      className="space-y-2"
      aria-label={trackingMessage("repositories")}
      data-slot="tracking-repository-list"
    >
      {repositories.map((repository) => (
        <li
          key={
            repository.repositoryKey ?? `${repository.owner}/${repository.name}`
          }
          className="space-y-1 rounded-md border p-2"
        >
          <p className="break-all font-medium">
            {repository.owner && repository.name
              ? `${repository.owner}/${repository.name}`
              : trackingMessage("repository")}
          </p>
          <TrackingFreshnessBadge status={repository.freshnessStatus} />
          <p className="break-all font-mono text-[11px] text-muted-foreground">
            {repository.pinnedCommit?.slice(0, 7) ?? ""}
            {repository.latestCommit
              ? ` → ${repository.latestCommit.slice(0, 7)}`
              : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}
