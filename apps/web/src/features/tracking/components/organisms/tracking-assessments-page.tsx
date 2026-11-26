"use client";

import { useDeferredValue, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCustomerTrackingOverviewQuery } from "@/lib/api/tracking-queries";
import { canCreateAssessment } from "@/lib/api/workspace-client";
import { useWorkspaceQuery } from "@/lib/api/workspace-queries";
import {
  ASSESSMENT_LIST_DATE_FILTERS,
  ASSESSMENT_LIST_SORT_OPTIONS,
  ASSESSMENT_LIST_STATUS_FILTERS,
  type AssessmentListDateFilter,
  type AssessmentListSortOption,
  type AssessmentListStatusFilter,
} from "../../types/assessment-list.types";
import { trackingMessage } from "../../utils/tracking-display";
import { TrackingError } from "../molecules/tracking-error";
import { AssessmentList } from "./assessment-list";

/**
 * Business purpose:
 * Host the Assessments directory page (Frame 18) with search, lifecycle filters,
 * date window, sort order, pagination, and row-level rename/delete dialogs.
 *
 * Business rules:
 * - Gate the "New assessment" CTA by `canCreateAssessment(workspace.user.role)`.
 * - Any filter or sort change resets pagination offset to 0.
 *
 * Execution flow:
 * 1. Load workspace permissions and customer tracking overview data.
 * 2. Render header with New assessment CTA.
 * 3. Render loading skeletons, error retry banner, or AssessmentList.
 *
 * Failure cases:
 * - Overview query failure displays TrackingError with retry action.
 *
 * Side effects:
 * - Navigates to `/assessments/new` on CTA click.
 */
export function TrackingAssessmentsPage() {
  const router = useRouter();
  const workspaceQuery = useWorkspaceQuery();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<AssessmentListStatusFilter>(
    ASSESSMENT_LIST_STATUS_FILTERS.all,
  );
  const [dateFilter, setDateFilter] = useState<AssessmentListDateFilter>(
    ASSESSMENT_LIST_DATE_FILTERS.all,
  );
  const [sortBy, setSortBy] = useState<AssessmentListSortOption>(
    ASSESSMENT_LIST_SORT_OPTIONS.recentlyUpdated,
  );
  const [offset, setOffset] = useState(0);

  const deferredSearch = useDeferredValue(search.trim());
  const query = useCustomerTrackingOverviewQuery(deferredSearch, 0);
  const data = query.data;
  const workspace =
    workspaceQuery.data?.kind === "loaded"
      ? workspaceQuery.data.workspace
      : null;

  function resetFilters() {
    setSearch("");
    setStatusFilter(ASSESSMENT_LIST_STATUS_FILTERS.all);
    setDateFilter(ASSESSMENT_LIST_DATE_FILTERS.all);
    setSortBy(ASSESSMENT_LIST_SORT_OPTIONS.recentlyUpdated);
    setOffset(0);
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 lg:px-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">
            {trackingMessage("assessmentsTitle")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {trackingMessage("assessmentsListSubtitle")}
          </p>
        </div>

        {workspace && canCreateAssessment(workspace.user.role) ? (
          <Button
            type="button"
            className="shrink-0 bg-primary text-primary-foreground"
            onClick={() => router.push("/assessments/new")}
          >
            {trackingMessage("newAssessment")}
          </Button>
        ) : null}
      </header>

      {query.isError ? (
        <TrackingError onRetry={() => void query.refetch()} />
      ) : null}

      {query.isPending && !data ? (
        <div className="flex flex-col gap-4" aria-label={trackingMessage("loading")}>
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      ) : null}

      {data ? (
        <AssessmentList
          assessments={data.assessments}
          referenceNowMs={
            Number.isFinite(Date.parse(data.generatedAt))
              ? Date.parse(data.generatedAt)
              : query.dataUpdatedAt
          }
          search={search}
          onSearchChange={(val) => {
            setSearch(val);
            setOffset(0);
          }}
          statusFilter={statusFilter}
          onStatusFilterChange={(val) => {
            setStatusFilter(val);
            setOffset(0);
          }}
          dateFilter={dateFilter}
          onDateFilterChange={(val) => {
            setDateFilter(val);
            setOffset(0);
          }}
          sortBy={sortBy}
          onSortByChange={(val) => {
            setSortBy(val);
            setOffset(0);
          }}
          offset={offset}
          onOffsetChange={setOffset}
          onResetFilters={resetFilters}
        />
      ) : null}
    </main>
  );
}
