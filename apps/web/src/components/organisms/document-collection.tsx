import type { ReactNode } from "react";
import { SearchIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import {
  DOCUMENT_VIEW_MODES,
  GalleryListToggle,
  type DocumentViewMode,
} from "../molecules/gallery-list-toggle";

/**
 * Business purpose: Provide the shared `DocumentCollection` shell for M10 (Reports) and M11 (Artifacts) supporting Gallery/List parity, search, filters, loading, empty, and pagination states.
 * Business rules:
 * - Both Gallery and List views render from the same filtered dataset and share the same toolbar and pagination footer.
 * Execution flow:
 * 1. Render toolbar with search input, optional `filters` slot, and `GalleryListToggle`.
 * 2. Render `errorSlot` on failure, `Skeleton` when loading, `emptySlot` when empty, or the active Gallery/List view.
 * 3. Render optional `paginationSlot` below the collection.
 * Failure cases:
 * - Loading and error states short-circuit the collection body cleanly.
 * Side effects:
 * - Pure layout container delegating state changes via callbacks.
 */
export function DocumentCollection({
  mode,
  onModeChange,
  search,
  onSearchChange,
  searchPlaceholder,
  filters,
  isPending = false,
  isError = false,
  isEmpty = false,
  errorSlot,
  emptySlot,
  galleryView,
  listView,
  paginationSlot,
  className,
}: {
  mode: DocumentViewMode;
  onModeChange: (mode: DocumentViewMode) => void;
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  filters?: ReactNode;
  isPending?: boolean;
  isError?: boolean;
  isEmpty?: boolean;
  errorSlot?: ReactNode;
  emptySlot?: ReactNode;
  galleryView: ReactNode;
  listView: ReactNode;
  paginationSlot?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {onSearchChange ? (
            <div className="relative min-w-60 sm:w-72">
              <SearchIcon
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                aria-label={searchPlaceholder ?? "Search"}
                value={search ?? ""}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder={searchPlaceholder}
                className="h-9 pl-9"
              />
            </div>
          ) : null}
          {filters}
        </div>

        <GalleryListToggle mode={mode} onModeChange={onModeChange} />
      </div>

      {isError ? errorSlot : null}

      {isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
      ) : null}

      {!isPending && !isError && isEmpty ? emptySlot : null}

      {!isPending && !isError && !isEmpty
        ? mode === DOCUMENT_VIEW_MODES.gallery
          ? galleryView
          : listView
        : null}

      {!isPending && !isError && paginationSlot ? paginationSlot : null}
    </div>
  );
}
