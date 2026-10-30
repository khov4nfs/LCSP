"use client";

import { Button } from "@/components/ui/button";
import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { trackingMessage } from "../../utils/tracking-display";
import type { TrackingPaginationProps } from "../../types/tracking-ui.types";

export function TrackingPagination({
  total,
  limit,
  offset,
  hasMore,
  onOffsetChange,
  showTotal = false,
}: TrackingPaginationProps) {
  if (!showTotal && total <= limit && offset === 0) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-2",
        showTotal ? "justify-between" : "justify-end",
      )}
    >
      {showTotal ? (
        <p className="text-sm text-muted-foreground">
          {total.toLocaleString(appLocale)}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={offset === 0}
          onClick={() => onOffsetChange(Math.max(0, offset - limit))}
        >
          {trackingMessage("previousPage")}
        </Button>
        <Button
          variant="outline"
          disabled={!hasMore}
          onClick={() => onOffsetChange(offset + limit)}
        >
          {trackingMessage("nextPage")}
        </Button>
      </div>
    </div>
  );
}
