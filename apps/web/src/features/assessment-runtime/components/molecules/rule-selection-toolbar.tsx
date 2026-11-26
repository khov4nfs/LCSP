import { SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { resolveAppMessage } from "@/lib/i18n";
import { appLocale } from "@/lib/locale";

/**
 * Business purpose: Render the Selected-Rule Audit selection overview banner and filter toolbar matching Figma Frame 76 (`1662:7135`).
 * Business rules:
 * - Zero selected rules keeps `Run selected rules` disabled and surfaces clear guidance without inventing a default selection.
 * - Preserves search and `Select all matching` actions without mutating prior assessment results.
 * Execution flow:
 * 1. Render `Selection overview` Midnight-Teal card with selected/total count and primary/clear actions.
 * 2. Render search input and `Select all matching` toggle bar.
 * Failure cases:
 * - Empty selection disables `Run selected rules` and `Clear selection`.
 * Side effects:
 * - Invokes `onRunSelected`, `onClearSelection`, `onSearchChange`, and `onToggleSelectAll`.
 */
export function RuleSelectionToolbar({
  selectedCount,
  totalCount,
  search,
  allMatchingSelected,
  submitting = false,
  onSearchChange,
  onToggleSelectAll,
  onRunSelected,
  onClearSelection,
}: {
  selectedCount: number;
  totalCount: number;
  search: string;
  allMatchingSelected: boolean;
  submitting?: boolean;
  onSearchChange: (value: string) => void;
  onToggleSelectAll: () => void;
  onRunSelected: () => void;
  onClearSelection: () => void;
}) {
  const countLabel = resolveAppMessage(
    "pages.assessmentWorkspace.selectedAudit.selectionOverview",
  )
    .replace("{selected}", selectedCount.toLocaleString(appLocale))
    .replace("{total}", totalCount.toLocaleString(appLocale));

  return (
    <div className="space-y-4">
      <section
        aria-label={resolveAppMessage(
          "pages.assessmentWorkspace.selectedAudit.title",
        )}
        className="relative flex flex-col justify-between gap-4 overflow-hidden rounded-2xl bg-linear-to-r from-bento-from to-bento-to px-5 py-4 text-bento-foreground shadow-sm sm:flex-row sm:items-center"
      >
        <span
          aria-hidden="true"
          className="absolute top-3.5 left-0 h-10 w-1 rounded-r-xs bg-status-info"
        />
        <div className="min-w-0 space-y-1 pl-2">
          <p className="text-xl font-semibold text-bento-heading">
            {countLabel}
          </p>
          <p className="text-sm text-bento-muted">
            {selectedCount === 0
              ? resolveAppMessage(
                  "pages.assessmentWorkspace.selectedAudit.noneSelected",
                )
              : resolveAppMessage(
                  "pages.assessmentWorkspace.selectedAudit.subtitle",
                )}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            type="button"
            disabled={selectedCount === 0 || submitting}
            onClick={onRunSelected}
            className="bg-brand-mint text-brand-deep hover:bg-brand-mint/90"
          >
            {resolveAppMessage(
              "pages.assessmentWorkspace.selectedAudit.runSelected",
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={selectedCount === 0 || submitting}
            onClick={onClearSelection}
            className="border-bento-border bg-bento-card text-bento-heading hover:bg-bento-card/80"
          >
            {resolveAppMessage(
              "pages.assessmentWorkspace.selectedAudit.clearSelection",
            )}
          </Button>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-60 flex-1 sm:max-w-sm">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label={resolveAppMessage(
              "pages.assessmentConversation.ruleAudit.search",
            )}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={resolveAppMessage(
              "pages.assessmentConversation.ruleAudit.search",
            )}
            className="h-9 pl-9"
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-brand-deep select-none">
          <Checkbox
            checked={allMatchingSelected}
            onCheckedChange={onToggleSelectAll}
          />
          <span>
            {resolveAppMessage(
              "pages.assessmentWorkspace.selectedAudit.selectAllMatching",
            )}
          </span>
        </label>
      </div>
    </div>
  );
}
