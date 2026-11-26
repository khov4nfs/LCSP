import type { AssessmentReportRepositoryPresentation } from "@lcsp/contracts/assessment-report";

import { copy } from "../../utils/conversation-copy";

/**
 * Business purpose: Show the customer which repositories one report covers, at which commit and source scope, and how
 * much of each repository's source was visible, so a result is never read as describing only one of them.
 * Business rules:
 * - One row per pinned repository in pinned order; the commit, prefix and scope are the report's recorded values.
 * - A limited scope is called out per repository instead of being averaged away.
 * Execution flow:
 * 1. Render the set digest, then one entry per repository with its identity, commit, prefix, scope and evidence count.
 * Failure cases:
 * - Nothing renders for an empty list; a report always has at least one repository.
 * Side effects:
 * - None; presentation only.
 */
export function ReportRepositorySet({
  repositories,
  repositorySetDigest,
}: {
  repositories: readonly AssessmentReportRepositoryPresentation[];
  repositorySetDigest: string;
}) {
  if (repositories.length === 0) return null;
  const labels = (key: string) => copy(`labels.${key}`);
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border p-4"
      aria-label={labels("repositories")}
      data-slot="report-repository-set"
    >
      <h2 className="text-lg font-semibold">{labels("repositories")}</h2>
      <p className="break-words text-xs text-muted-foreground">
        {labels("repositorySetDigest")}: {repositorySetDigest}
      </p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {repositories.map((repository) => (
          <li
            key={repository.repositoryKey}
            className="min-w-0 rounded-md border p-3 text-sm"
          >
            <p className="break-words font-medium">
              {repository.repositoryKey} · {repository.repositoryFullName}
            </p>
            <dl className="mt-2 grid gap-1 text-xs">
              <div>
                <dt className="text-muted-foreground">{labels("commit")}</dt>
                <dd className="break-all">{repository.repositoryCommit}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{labels("prefix")}</dt>
                <dd className="break-words">
                  {repository.sourcePathPrefix ?? labels("unavailable")}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {labels("repositoryScope")}
                </dt>
                <dd>
                  {repository.sourceScope.mode} ·{" "}
                  {repository.sourceScope.visibility}
                  {repository.sourceScope.limitationReasons.length > 0
                    ? ` (${repository.sourceScope.limitationReasons.join("; ")})`
                    : ""}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {labels("repositoryEvidence")}
                </dt>
                <dd>{repository.evidenceIds.length}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}
