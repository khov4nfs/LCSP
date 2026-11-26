"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { trackingMessage } from "../../utils/tracking-display";
import type { TrackingPaginationProps } from "../../types/tracking-ui.types";

/**
 * Shared pagination control aligned with Figma LCSP Data / Pagination (1701:6622).
 * Renders Previous, bounded numbered page pills, and Next.
 */
export function TrackingPagination({
  total,
  limit,
  offset,
  hasMore,
  onOffsetChange,
  showTotal = false,
}: TrackingPaginationProps) {
  if (!showTotal && total <= limit && offset === 0) return null;

  const safeLimit = Math.max(1, limit);
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));
  const currentPage = Math.min(totalPages, Math.floor(offset / safeLimit) + 1);

  const visiblePages: number[] = [];
  const startPage = Math.max(1, currentPage - 1);
  const endPage = Math.min(totalPages, startPage + 2);
  for (let p = startPage; p <= endPage; p += 1) {
    visiblePages.push(p);
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2",
        showTotal ? "justify-between" : "justify-end",
      )}
      data-component="TrackingPagination"
    >
      {showTotal ? (
        <p className="text-xs text-muted-foreground tabular-nums">
          {total.toLocaleString(appLocale)}
        </p>
      ) : null}
      <nav aria-label="Pagination" className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={offset === 0}
          onClick={() => onOffsetChange(Math.max(0, offset - safeLimit))}
          className="h-7 gap-1 px-2.5 text-xs"
        >
          <ChevronLeftIcon className="size-3.5" aria-hidden="true" />
          {trackingMessage("previousPage")}
        </Button>

        {visiblePages.map((page) => {
          const isCurrent = page === currentPage;
          return (
            <Button
              key={page}
              type="button"
              variant={isCurrent ? "default" : "outline"}
              size="sm"
              aria-current={isCurrent ? "page" : undefined}
              onClick={() => onOffsetChange((page - 1) * safeLimit)}
              className={cn(
                "size-7 p-0 text-xs tabular-nums",
                isCurrent ? "bg-primary text-primary-foreground" : null,
              )}
            >
              {page.toLocaleString(appLocale)}
            </Button>
          );
        })}

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!hasMore && currentPage >= totalPages}
          onClick={() => onOffsetChange(offset + safeLimit)}
          className="h-7 gap-1 px-2.5 text-xs"
        >
          {trackingMessage("nextPage")}
          <ChevronRightIcon className="size-3.5" aria-hidden="true" />
        </Button>
      </nav>
    </div>
  );
}
