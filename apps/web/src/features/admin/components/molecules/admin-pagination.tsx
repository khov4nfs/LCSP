"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { MessageKey } from "@lcsp/i18n";

import { Button } from "@/components/ui/button";
import { resolveAppMessage } from "@/lib/i18n";
import type { AdminPaginationProps } from "@/features/admin/types/admin.types";

export function AdminPagination({
  page,
  totalPages,
  onPageChange,
  disabled = false,
}: AdminPaginationProps) {
  const previousLabel = resolveAppMessage(
    "pages.admin.usersList.pagination.previous" as MessageKey,
  );
  const nextLabel = resolveAppMessage(
    "pages.admin.usersList.pagination.next" as MessageKey,
  );
  const pageOfTemplate = resolveAppMessage(
    "pages.admin.usersList.pagination.pageOf" as MessageKey,
  );

  const canPrevious = page > 1 && !disabled;
  const canNext = page < totalPages && !disabled;

  return (
    <div className="flex w-full max-w-[1112px] items-center justify-between pt-4">
      {/* Left: Page Status */}
      <span className="text-[11.5px] text-muted-foreground">
        {pageOfTemplate
          .replace("{page}", String(page))
          .replace("{totalPages}", String(Math.max(1, totalPages)))}
      </span>

      {/* Right: Prev & Next Buttons */}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => onPageChange(page - 1)}
          disabled={!canPrevious}
          className="h-[36px] w-[120px] rounded-[10px] border-border bg-secondary text-[12.5px] font-medium text-secondary-foreground hover:bg-secondary/80 shadow-xs disabled:opacity-40"
        >
          <ChevronLeftIcon className="size-4 mr-1" />
          {previousLabel}
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={() => onPageChange(page + 1)}
          disabled={!canNext}
          className="h-[36px] w-[130px] rounded-[10px] border-border bg-secondary text-[12.5px] font-medium text-secondary-foreground hover:bg-secondary/80 shadow-xs disabled:opacity-40"
        >
          {nextLabel}
          <ChevronRightIcon className="size-4 ml-1" />
        </Button>
      </div>

    </div>
  );
}
