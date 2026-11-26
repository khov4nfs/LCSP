"use client";

import { useMemo } from "react";
import type { CustomerTrackingAssessmentItem } from "@lcsp/contracts/assessment-domain";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { appLocale } from "@/lib/locale";
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
import { AssessmentFilterToolbar } from "../molecules/assessment-filter-toolbar";
import {
  AssessmentRow,
  resolveAssessmentListPresentation,
} from "../molecules/assessment-row";
import { TrackingEmptyState } from "../molecules/tracking-empty-state";
import { TrackingPagination } from "../molecules/tracking-pagination";

const PAGE_SIZE = 10;

type AssessmentListProps = {
  assessments: readonly CustomerTrackingAssessmentItem[];
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: AssessmentListStatusFilter;
  onStatusFilterChange: (value: AssessmentListStatusFilter) => void;
  dateFilter: AssessmentListDateFilter;
  onDateFilterChange: (value: AssessmentListDateFilter) => void;
  sortBy: AssessmentListSortOption;
  onSortByChange: (value: AssessmentListSortOption) => void;
  offset: number;
  onOffsetChange: (offset: number) => void;
  onResetFilters: () => void;
};

/**
 * Computes coverage ratio for sorting assessments by highest coverage.
 */
function getCoverageRatio(item: CustomerTrackingAssessmentItem): number {
  const concluded =
    item.compliance.compliantCount +
    item.compliance.nonCompliantCount +
    item.compliance.notApplicableCount;
  const total = concluded + item.compliance.unresolvedCount;
  return total > 0 ? concluded / total : 0;
}

/**
 * Business purpose:
 * Present the filterable, sortable, and paginated Assessments table (Frame 18)
 * with lifecycle summary counts and row-level rename/delete actions.
 *
 * Business rules:
 * - Lifecycle counts always reflect the loaded assessments before status/date filtering.
 * - Filtered empty states expose a one-click Reset filters action.
 *
 * Execution flow:
 * 1. Compute lifecycle counts across `assessments`.
 * 2. Filter by search query (name or repo), status bucket, and date window.
 * 3. Sort and slice the current page of results, rendering AssessmentRow items.
 *
 * Failure cases:
 * - Invalid timestamps are excluded only when a strict date window filter is active.
 *
 * Side effects:
 * - Delegates filter, sort, and pagination changes to parent state callbacks.
 */
export function AssessmentList({
  assessments,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  dateFilter,
  onDateFilterChange,
  sortBy,
  onSortByChange,
  offset,
  onOffsetChange,
  onResetFilters,
}: AssessmentListProps) {
  const counts = useMemo<AssessmentLifecycleCounts>(() => {
    const summary: AssessmentLifecycleCounts = {
      all: assessments.length,
      completed: 0,
      running: 0,
      needsInfo: 0,
      draft: 0,
      failed: 0,
    };
    for (const item of assessments) {
      const { statusFilter: bucket } = resolveAssessmentListPresentation(item);
      if (bucket === ASSESSMENT_LIST_STATUS_FILTERS.completed) summary.completed += 1;
      else if (bucket === ASSESSMENT_LIST_STATUS_FILTERS.running) summary.running += 1;
      else if (bucket === ASSESSMENT_LIST_STATUS_FILTERS.needsInfo) summary.needsInfo += 1;
      else if (bucket === ASSESSMENT_LIST_STATUS_FILTERS.draft) summary.draft += 1;
      else if (bucket === ASSESSMENT_LIST_STATUS_FILTERS.failed) summary.failed += 1;
    }
    return summary;
  }, [assessments]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const now = Date.now();
    const cutoffMs =
      dateFilter === ASSESSMENT_LIST_DATE_FILTERS.last7Days
        ? 7 * 24 * 60 * 60 * 1000
        : dateFilter === ASSESSMENT_LIST_DATE_FILTERS.last30Days
          ? 30 * 24 * 60 * 60 * 1000
          : null;

    const matching = assessments.filter((item) => {
      if (query) {
        const repoText = `${item.repository.owner ?? ""}/${item.repository.name ?? ""}`.toLowerCase();
        if (
          !item.name.toLowerCase().includes(query) &&
          !repoText.includes(query)
        ) {
          return false;
        }
      }

      if (statusFilter !== ASSESSMENT_LIST_STATUS_FILTERS.all) {
        const { statusFilter: bucket } = resolveAssessmentListPresentation(item);
        if (bucket !== statusFilter) return false;
      }

      if (cutoffMs !== null) {
        const updatedMs = Date.parse(item.updatedAt);
        if (!Number.isFinite(updatedMs) || now - updatedMs > cutoffMs) {
          return false;
        }
      }

      return true;
    });

    return [...matching].sort((a, b) => {
      if (sortBy === ASSESSMENT_LIST_SORT_OPTIONS.nameAsc) {
        return a.name.localeCompare(b.name);
      }
      if (sortBy === ASSESSMENT_LIST_SORT_OPTIONS.highestCoverage) {
        return getCoverageRatio(b) - getCoverageRatio(a);
      }
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [assessments, dateFilter, search, sortBy, statusFilter]);

  const safeOffset = offset >= filtered.length ? 0 : offset;
  const pageItems = filtered.slice(safeOffset, safeOffset + PAGE_SIZE);
  const hasMore = safeOffset + PAGE_SIZE < filtered.length;
  const hasActiveFilter =
    search.trim().length > 0 ||
    statusFilter !== ASSESSMENT_LIST_STATUS_FILTERS.all ||
    dateFilter !== ASSESSMENT_LIST_DATE_FILTERS.all;

  return (
    <div className="flex flex-col gap-5" data-component="AssessmentList">
      <AssessmentFilterToolbar
        counts={counts}
        search={search}
        onSearchChange={onSearchChange}
        statusFilter={statusFilter}
        onStatusFilterChange={onStatusFilterChange}
        dateFilter={dateFilter}
        onDateFilterChange={onDateFilterChange}
        sortBy={sortBy}
        onSortByChange={onSortByChange}
      />

      <Card className="overflow-hidden rounded-xl border-border bg-card shadow-xs">
        <CardHeader className="flex flex-row items-center justify-between gap-4 border-b border-border/70 pb-4">
          <CardTitle className="text-lg font-semibold tracking-tight">
            {trackingMessage("allAssessments")}
          </CardTitle>
          <p className="text-xs text-muted-foreground tabular-nums">
            {trackingMessage("showingRecords")
              .replace("{shown}", pageItems.length.toLocaleString(appLocale))
              .replace("{total}", filtered.length.toLocaleString(appLocale))}
          </p>
        </CardHeader>

        <CardContent className="p-0">
          {pageItems.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="pl-4 font-semibold">
                        {trackingMessage("colAssessmentRepo")}
                      </TableHead>
                      <TableHead className="font-semibold">
                        {trackingMessage("updatedAt")}
                      </TableHead>
                      <TableHead className="font-semibold">
                        {trackingMessage("colCoverage")}
                      </TableHead>
                      <TableHead className="font-semibold">
                        {trackingMessage("colStatus")}
                      </TableHead>
                      <TableHead className="pr-4 text-right font-semibold">
                        {trackingMessage("colNextAction")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageItems.map((item) => (
                      <AssessmentRow key={item.assessmentId} item={item} />
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 px-4 py-3">
                <p className="text-xs text-muted-foreground tabular-nums">
                  {trackingMessage("showingRecords")
                    .replace("{shown}", pageItems.length.toLocaleString(appLocale))
                    .replace("{total}", filtered.length.toLocaleString(appLocale))}
                </p>
                <TrackingPagination
                  total={filtered.length}
                  limit={PAGE_SIZE}
                  offset={safeOffset}
                  hasMore={hasMore}
                  onOffsetChange={onOffsetChange}
                />
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-3 p-8 text-center">
              <TrackingEmptyState>
                {trackingMessage("noAssessments")}
              </TrackingEmptyState>
              {hasActiveFilter ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onResetFilters}
                >
                  {trackingMessage("resetFilters")}
                </Button>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
