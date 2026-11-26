"use client";

import type { AssessmentDiscoveryRunView } from "@lcsp/contracts/assessment-domain";
import { Button } from "@/components/ui/button";

import { DISCOVERY_RUN_STATUS_COPY_KEYS } from "../../config/discovery-run-status-copy";
import { copy } from "../../utils/conversation-copy";

/**
 * Business purpose: Show the customer how far the source scan of each pinned repository has come and let them
 * choose whose results to review.
 * Business rules:
 * - One row per repository run, in the order the repositories were pinned; the status is the API's, never inferred.
 * - Choosing a repository only changes what is displayed; it never starts a scan or selects an audit rule.
 * Execution flow:
 * 1. Render each run's repository key with its localized status.
 * 2. Mark the viewed repository and report a pick to the parent.
 * Failure cases:
 * - Nothing renders for a single repository or an empty batch; the overview already shows that run.
 * Side effects:
 * - None beyond calling the supplied selection callback.
 */
export function DiscoveryRepositoryProgress({
  runs,
  viewedKey,
  onView,
}: {
  runs: readonly AssessmentDiscoveryRunView[];
  viewedKey: string | null;
  onView: (repositoryKey: string) => void;
}) {
  if (runs.length < 2) return null;
  return (
    <section
      aria-label={copy("ruleAudit.discovery.repositories")}
      className="space-y-2"
      data-slot="discovery-repository-progress"
    >
      <p className="font-medium">{copy("ruleAudit.discovery.repositories")}</p>
      <ul className="flex flex-wrap gap-2">
        {runs.map((run) => {
          const key = run.repositoryKey ?? run.runId;
          return (
            <li key={run.runId}>
              <Button
                type="button"
                variant={key === viewedKey ? "secondary" : "outline"}
                size="sm"
                aria-pressed={key === viewedKey}
                aria-label={copy("ruleAudit.discovery.showRepository", {
                  repository: key,
                })}
                onClick={() => onView(key)}
              >
                {key} · {copy(DISCOVERY_RUN_STATUS_COPY_KEYS[run.status])}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
