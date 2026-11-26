import { GitCommitHorizontal } from "lucide-react";

import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Business purpose: Display the pinned source revision (commit SHA) or default HEAD pinning behavior during setup.
 * Business rules:
 * - Shows a shortened 7-character commit SHA when pinned, otherwise explains that HEAD will be pinned on connect.
 * Execution flow:
 * 1. Format `pinnedCommitSha` to 7 characters when present.
 * 2. Render commit icon, label, and revision value.
 * Failure cases:
 * - Missing `pinnedCommitSha` falls back to default pinning description.
 * Side effects:
 * - Pure presentational component.
 */
export function SourceVersionPicker({
  pinnedCommitSha,
  className,
}: {
  pinnedCommitSha?: string | null;
  className?: string;
}) {
  const shortSha = pinnedCommitSha?.trim().slice(0, 7);

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-3.5 py-2.5",
        className,
      )}
    >
      <GitCommitHorizontal
        className="size-4 shrink-0 text-brand"
        aria-hidden="true"
      />
      <div className="min-w-0">
        <p className="text-xs font-medium text-foreground">
          {resolveAppMessage(
            "pages.assessmentFlow.source.pinnedRevisionLabel",
          )}
        </p>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {shortSha
            ? resolveAppMessage(
                "pages.assessmentFlow.repository.pinnedCommit",
              ).replace("{commit}", shortSha)
            : resolveAppMessage(
                "pages.assessmentFlow.source.pinnedRevisionDefault",
              )}
        </p>
      </div>
    </div>
  );
}
