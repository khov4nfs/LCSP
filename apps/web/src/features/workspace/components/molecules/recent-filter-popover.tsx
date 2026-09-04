"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { resolveAppMessage } from "@/lib/i18n";

import {
  RECENT_ACTIVITY_OPTIONS,
  RECENT_GROUP_OPTIONS,
  RECENT_SORT_OPTIONS,
  RECENT_STATUS_OPTIONS,
  RECENT_TYPE_OPTIONS,
} from "../../config/recent-filter-options";
import {
  RECENT_FILTER_KEYS,
  type RecentFilterKey,
  type RecentFilterOption,
  type RecentFilters,
} from "../../types/recent-filter.types";
import { RecentFilterSubmenu } from "./recent-filter-submenu";
import { RecentFilterTrigger } from "./recent-filter-trigger";

type RecentFilterPopoverProps = {
  filters: RecentFilters;
  onOpenChange: (open: boolean) => void;
  onUpdateFilter: <Value extends string>(
    key: RecentFilterKey,
    value: Value,
  ) => void;
  open: boolean;
};

export function RecentFilterPopover({
  filters,
  onOpenChange,
  onUpdateFilter,
  open,
}: RecentFilterPopoverProps) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger render={<RecentFilterTrigger open={open} />} />
      <DropdownMenuContent
        align="end"
        className="h-41.5 w-44 min-w-44 overflow-visible rounded-xl border border-border bg-popover p-0.75 text-popover-foreground shadow-[0_8px_9px_rgba(0,0,0,0.18)] ring-0 dark:shadow-[0_8px_9px_rgba(0,0,0,0.35)]"
        side="bottom"
        sideOffset={4}
      >
        <RecentFilterSubmenu
          label={resolveAppMessage("pages.appShell.recentFilter.labels.type")}
          menuKey={RECENT_FILTER_KEYS.type}
          onValueChange={(value) =>
            onUpdateFilter(RECENT_FILTER_KEYS.type, value)
          }
          options={RECENT_TYPE_OPTIONS}
          selectedValue={filters.type}
          valueLabel={getOptionLabel(RECENT_TYPE_OPTIONS, filters.type)}
        />
        <RecentFilterSubmenu
          label={resolveAppMessage("pages.appShell.recentFilter.labels.status")}
          menuKey={RECENT_FILTER_KEYS.status}
          onValueChange={(value) =>
            onUpdateFilter(RECENT_FILTER_KEYS.status, value)
          }
          options={RECENT_STATUS_OPTIONS}
          selectedValue={filters.status}
          valueLabel={getOptionLabel(RECENT_STATUS_OPTIONS, filters.status)}
        />
        <RecentFilterSubmenu
          label={resolveAppMessage(
            "pages.appShell.recentFilter.labels.lastActivity",
          )}
          menuKey={RECENT_FILTER_KEYS.lastActivity}
          onValueChange={(value) =>
            onUpdateFilter(RECENT_FILTER_KEYS.lastActivity, value)
          }
          options={RECENT_ACTIVITY_OPTIONS}
          selectedValue={filters.lastActivity}
          valueLabel={getOptionLabel(
            RECENT_ACTIVITY_OPTIONS,
            filters.lastActivity,
          )}
        />
        <DropdownMenuSeparator className="mx-1.5 my-1.5 bg-border" />
        <RecentFilterSubmenu
          label={resolveAppMessage(
            "pages.appShell.recentFilter.labels.groupBy",
          )}
          menuKey={RECENT_FILTER_KEYS.groupBy}
          onValueChange={(value) =>
            onUpdateFilter(RECENT_FILTER_KEYS.groupBy, value)
          }
          options={RECENT_GROUP_OPTIONS}
          selectedValue={filters.groupBy}
          valueLabel={getOptionLabel(RECENT_GROUP_OPTIONS, filters.groupBy)}
        />
        <RecentFilterSubmenu
          label={resolveAppMessage("pages.appShell.recentFilter.labels.sortBy")}
          menuKey={RECENT_FILTER_KEYS.sortBy}
          onValueChange={(value) =>
            onUpdateFilter(RECENT_FILTER_KEYS.sortBy, value)
          }
          options={RECENT_SORT_OPTIONS}
          selectedValue={filters.sortBy}
          valueLabel={getOptionLabel(RECENT_SORT_OPTIONS, filters.sortBy)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function getOptionLabel<Value extends string>(
  options: RecentFilterOption<Value>[],
  value: Value,
) {
  return resolveAppMessage(
    options.find((option) => option.value === value)?.labelKey ??
      "pages.appShell.recentFilter.options.all",
  );
}
