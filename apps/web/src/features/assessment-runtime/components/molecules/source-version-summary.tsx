import Link from "next/link";
import { GitBranchIcon, ScaleIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Business purpose: Display the pinned repository, commit SHA, legal source version, and provenance/report links in both Overview and Source & evidence tabs.
 * Business rules:
 * - Preserves pinned commit SHA formatting (12 chars) and never fabricates repository or legal source versions.
 * Execution flow:
 * 1. Render repository name, pinned commit SHA (when present), and legal source version.
 * 2. Render optional `View source & evidence`, `View report`, and `View provenance` actions.
 * Failure cases:
 * - Missing repository or legal version falls back to neutral dash.
 * Side effects:
 * - Pure presentational component with Next.js links and optional tab switch callback.
 */
export function SourceVersionSummary({
  assessmentId,
  repositoryName,
  commitSha,
  legalSourceVersion,
  onViewSourceEvidence,
  showArtifactLinks = false,
  className,
}: {
  assessmentId: string;
  repositoryName?: string | null;
  commitSha?: string | null;
  legalSourceVersion?: string | null;
  onViewSourceEvidence?: () => void;
  showArtifactLinks?: boolean;
  className?: string;
}) {
  const shortCommit = commitSha?.trim().slice(0, 12);

  return (
    <div
      className={cn(
        "flex flex-col justify-between gap-4 sm:flex-row sm:items-end",
        className,
      )}
    >
      <div className="min-w-0 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <GitBranchIcon
            className="size-4 shrink-0 text-brand"
            aria-hidden="true"
          />
          <span className="truncate">
            {resolveAppMessage("pages.assessmentWorkspace.overview.repositoryPrefix")}{" "}
            · {repositoryName ?? "—"}
          </span>
          {shortCommit ? (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
              {shortCommit}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ScaleIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {resolveAppMessage(
              "pages.assessmentWorkspace.overview.legalSourcePrefix",
            )}{" "}
            · {legalSourceVersion ?? "—"}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {onViewSourceEvidence ? (
          <Button type="button" size="sm" onClick={onViewSourceEvidence}>
            {resolveAppMessage(
              "pages.assessmentWorkspace.overview.viewSourceEvidence",
            )}
          </Button>
        ) : null}
        {showArtifactLinks ? (
          <>
            <Button
              render={
                <Link
                  href={`/assessments/${encodeURIComponent(assessmentId)}/provenance`}
                />
              }
              nativeButton={false}
              variant="outline"
              size="sm"
            >
              {resolveAppMessage("pages.assessmentWorkspace.source.viewProvenance")}
            </Button>
            <Button
              render={
                <Link
                  href={`/assessments/${encodeURIComponent(assessmentId)}/report`}
                />
              }
              nativeButton={false}
              variant="outline"
              size="sm"
            >
              {resolveAppMessage("pages.assessmentWorkspace.source.viewReport")}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
