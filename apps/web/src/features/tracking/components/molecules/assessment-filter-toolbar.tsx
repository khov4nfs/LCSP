"use client";

import { SearchIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";
import {
  ASSESSMENT_LIST_DATE_FILTERS,
  ASSESSMENT_LIST_SORT_OPTIONS,
  ASSESSMENT_LIST_STATUS_FILTERS,
  type AssessmentLifecycleCounts,
  type AssessmentListDateFilter,
  type AssessmentListSortOption,
  type AssessmentListStatusFilter,
} from "../../types/assessment-list.types";
import { trackingMessage } from "../../utils/tracking-display";

type AssessmentFilterToolbarProps = {
  counts: AssessmentLifecycleCounts;
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: AssessmentListStatusFilter;
  onStatusFilterChange: (value: AssessmentListStatusFilter) => void;
  dateFilter: AssessmentListDateFilter;
  onDateFilterChange: (value: AssessmentListDateFilter) => void;
  sortBy: AssessmentListSortOption;
  onSortByChange: (value: AssessmentListSortOption) => void;
};

/**
 * Business purpose:
 * Provide lifecycle status summary pills and search/status/date/sort controls
 * aligned with Frame 18 (1688:3371 & 1709:7687).
 *
 * Business rules:
 * - Lifecycle counts reconcile with the loaded assessment collection.
 * - Selecting any lifecycle pill updates `statusFilter` directly.
 *
 * Execution flow:
 * 1. Render clickable lifecycle summary strip with proportional underline bars.
 * 2. Render responsive search input + status/date/sort Select controls.
 *
 * Failure cases:
 * - Zero total assessments safely renders 0% proportion bars without NaN.
 *
 * Side effects:
 * - Invokes parent filter/sort callbacks which reset pagination to page 1.
 */
export function AssessmentFilterToolbar({
  counts,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  dateFilter,
  onDateFilterChange,
  sortBy,
  onSortByChange,
}: AssessmentFilterToolbarProps) {
  const total = Math.max(1, counts.all);

  const summaryItems = [
    {
      key: ASSESSMENT_LIST_STATUS_FILTERS.all,
      label: trackingMessage("statusAll"),
      count: counts.all,
      textClass: "text-brand-deep",
      barColor: "var(--status-completed)",
      showBar: false,
    },
    {
      key: ASSESSMENT_LIST_STATUS_FILTERS.completed,
      label: trackingMessage("statusCompleted"),
      count: counts.completed,
      textClass: "text-emerald-800 dark:text-emerald-300",
      barColor: "var(--status-completed)",
      showBar: true,
    },
    {
      key: ASSESSMENT_LIST_STATUS_FILTERS.running,
      label: trackingMessage("statusRunning"),
      count: counts.running,
      textClass: "text-indigo-700 dark:text-indigo-300",
      barColor: "var(--status-running)",
      showBar: true,
    },
    {
      key: ASSESSMENT_LIST_STATUS_FILTERS.needsInfo,
      label: trackingMessage("statusNeedsInfo"),
      count: counts.needsInfo,
      textClass: "text-amber-800 dark:text-amber-300",
      barColor: "var(--status-warning)",
      showBar: true,
    },
    {
      key: ASSESSMENT_LIST_STATUS_FILTERS.draft,
      label: trackingMessage("statusDraft"),
      count: counts.draft,
      textClass: "text-muted-foreground",
      barColor: "var(--status-draft)",
      showBar: true,
    },
    {
      key: ASSESSMENT_LIST_STATUS_FILTERS.failed,
      label: trackingMessage("statusFailed"),
      count: counts.failed,
      textClass: "text-red-700 dark:text-red-300",
      barColor: "var(--status-danger)",
      showBar: true,
    },
  ] as const;

  const statusLabels: Record<AssessmentListStatusFilter, string> = {
    [ASSESSMENT_LIST_STATUS_FILTERS.all]: trackingMessage("filterAllStatuses"),
    [ASSESSMENT_LIST_STATUS_FILTERS.completed]: trackingMessage("statusCompleted"),
    [ASSESSMENT_LIST_STATUS_FILTERS.running]: trackingMessage("statusRunning"),
    [ASSESSMENT_LIST_STATUS_FILTERS.needsInfo]: trackingMessage("statusNeedsInfo"),
    [ASSESSMENT_LIST_STATUS_FILTERS.draft]: trackingMessage("statusDraft"),
    [ASSESSMENT_LIST_STATUS_FILTERS.failed]: trackingMessage("statusFailed"),
  };

  const dateLabels: Record<AssessmentListDateFilter, string> = {
    [ASSESSMENT_LIST_DATE_FILTERS.all]: trackingMessage("filterAllDates"),
    [ASSESSMENT_LIST_DATE_FILTERS.last7Days]: trackingMessage("filterLast7Days"),
    [ASSESSMENT_LIST_DATE_FILTERS.last30Days]: trackingMessage("filterLast30Days"),
  };

  const sortLabels: Record<AssessmentListSortOption, string> = {
    [ASSESSMENT_LIST_SORT_OPTIONS.recentlyUpdated]: trackingMessage(
      "sortRecentlyUpdated",
    ),
    [ASSESSMENT_LIST_SORT_OPTIONS.nameAsc]: trackingMessage("sortNameAsc"),
    [ASSESSMENT_LIST_SORT_OPTIONS.highestCoverage]: trackingMessage(
      "sortHighestCoverage",
    ),
  };

  return (
    <div
      className="flex flex-col gap-4"
      data-component="AssessmentFilterToolbar"
    >
      <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-card px-4 py-3 sm:grid-cols-3 lg:grid-cols-6">
        {summaryItems.map((item) => {
          const isSelected = statusFilter === item.key;
          const pct = counts.all > 0 ? Math.min(100, (item.count / total) * 100) : 0;

          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onStatusFilterChange(item.key)}
              aria-pressed={isSelected}
              className={cn(
                "flex flex-col items-start gap-1.5 rounded-lg px-2 py-1 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isSelected ? "bg-muted/70" : null,
              )}
            >
              <span className={cn("text-sm font-semibold", item.textClass)}>
                {item.label}{" "}
                <span className="tabular-nums">
                  {item.count.toLocaleString(appLocale)}
                </span>
              </span>
              {item.showBar ? (
                <span
                  className="h-0.75 w-22 overflow-hidden rounded-full bg-muted"
                  aria-hidden="true"
                >
                  <span
                    className="block h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
                    style={{ width: `${pct}%`, backgroundColor: item.barColor }}
                  />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,0.75fr)_minmax(0,1.1fr)]">
        <label className="relative block">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            aria-label={trackingMessage("searchLabel")}
            placeholder={trackingMessage("searchRepoPlaceholder")}
            className="bg-card pl-9"
          />
        </label>

        <Select
          value={statusFilter}
          onValueChange={(value) => {
            if (value) onStatusFilterChange(value as AssessmentListStatusFilter);
          }}
        >
          <SelectTrigger
            aria-label={trackingMessage("filterAllStatuses")}
            className="w-full bg-card"
          >
            <SelectValue>{statusLabels[statusFilter]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.values(ASSESSMENT_LIST_STATUS_FILTERS).map((val) => (
              <SelectItem key={val} value={val}>
                {statusLabels[val]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={dateFilter}
          onValueChange={(value) => {
            if (value) onDateFilterChange(value as AssessmentListDateFilter);
          }}
        >
          <SelectTrigger
            aria-label={trackingMessage("filterAllDates")}
            className="w-full bg-card"
          >
            <SelectValue>{dateLabels[dateFilter]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.values(ASSESSMENT_LIST_DATE_FILTERS).map((val) => (
              <SelectItem key={val} value={val}>
                {dateLabels[val]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={sortBy}
          onValueChange={(value) => {
            if (value) onSortByChange(value as AssessmentListSortOption);
          }}
        >
          <SelectTrigger
            aria-label={trackingMessage("sortRecentlyUpdated")}
            className="w-full bg-card"
          >
            <SelectValue>{sortLabels[sortBy]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.values(ASSESSMENT_LIST_SORT_OPTIONS).map((val) => (
              <SelectItem key={val} value={val}>
                {sortLabels[val]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
