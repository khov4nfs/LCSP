import { LayoutGridIcon, ListIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const DOCUMENT_VIEW_MODES = {
  gallery: "gallery",
  list: "list",
} as const;

export type DocumentViewMode =
  (typeof DOCUMENT_VIEW_MODES)[keyof typeof DOCUMENT_VIEW_MODES];

/**
 * Business purpose: Provide a shared Gallery/List view mode toggle consumed by both M10 (Reports) and M11 (Artifacts).
 * Business rules:
 * - Both buttons expose `aria-pressed` so keyboard and screen-reader users can verify the active view mode.
 * Execution flow:
 * 1. Render Gallery and List buttons inside a bordered segmented control.
 * 2. Invoke `onModeChange` on selection.
 * Failure cases:
 * - None.
 * Side effects:
 * - Pure presentational control.
 */
export function GalleryListToggle({
  mode,
  onModeChange,
  className,
}: {
  mode: DocumentViewMode;
  onModeChange: (mode: DocumentViewMode) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={`${resolveAppMessage("pages.workspace.tracking.galleryView")} / ${resolveAppMessage("pages.workspace.tracking.listView")}`}
      className={cn(
        "inline-flex items-center rounded-lg border border-border bg-card p-1",
        className,
      )}
    >
      <Button
        type="button"
        variant={mode === DOCUMENT_VIEW_MODES.gallery ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={mode === DOCUMENT_VIEW_MODES.gallery}
        onClick={() => onModeChange(DOCUMENT_VIEW_MODES.gallery)}
        className="h-7 gap-1.5 px-2.5 text-xs"
      >
        <LayoutGridIcon className="size-3.5" aria-hidden="true" />
        <span>{resolveAppMessage("pages.workspace.tracking.galleryView")}</span>
      </Button>
      <Button
        type="button"
        variant={mode === DOCUMENT_VIEW_MODES.list ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={mode === DOCUMENT_VIEW_MODES.list}
        onClick={() => onModeChange(DOCUMENT_VIEW_MODES.list)}
        className="h-7 gap-1.5 px-2.5 text-xs"
      >
        <ListIcon className="size-3.5" aria-hidden="true" />
        <span>{resolveAppMessage("pages.workspace.tracking.listView")}</span>
      </Button>
    </div>
  );
}
