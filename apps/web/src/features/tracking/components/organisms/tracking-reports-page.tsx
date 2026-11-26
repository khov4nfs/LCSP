"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  TRACKING_FRESHNESS_STATUSES,
  type TrackingFreshnessStatus,
} from "@lcsp/contracts/assessment-domain";

import { DocumentGalleryCard } from "@/components/molecules/document-gallery-card";
import {
  DOCUMENT_VIEW_MODES,
  type DocumentViewMode,
} from "@/components/molecules/gallery-list-toggle";
import { NextMetricCard } from "@/components/molecules/next-metric-card";
import { DocumentCollection } from "@/components/organisms/document-collection";
import { NEXT_METRIC_VARIANTS } from "@/components/types/dashboard-primitives.types";
import { AssessmentReportActions } from "@/features/assessment-runtime/components/molecules/assessment-report-actions";
import { useCustomerTrackingReportsQuery } from "@/lib/api/tracking-queries";
import { appLocale } from "@/lib/locale";

import {
  formatTrackingDate,
  trackingMessage,
} from "../../utils/tracking-display";
import { TrackingEmptyState } from "../molecules/tracking-empty-state";
import { TrackingError } from "../molecules/tracking-error";
import { TrackingFilterSelect } from "../molecules/tracking-filter-select";
import { TrackingPagination } from "../molecules/tracking-pagination";
import {
  TrackingFreshnessBadge,
  TrackingTrustBadge,
} from "../molecules/tracking-status-badge";

/**
 * Business purpose: Render the Customer Reports Library (Figma Frames 23, 27, 87) with KPI strip, Gallery/List parity, freshness filter, and export/download actions.
 * Business rules:
 * - Gallery and List modes share the exact same filtered `items` and pagination state.
 * - Preserves `TrackingFreshnessBadge`, `TrackingTrustBadge`, and `AssessmentReportActions` contracts without fabricating report availability.
 * Execution flow:
 * 1. Fetch reports via `useCustomerTrackingReportsQuery`.
 * 2. Compute summary metrics (`Total`, `Current`, `Stale`) and filter by search query.
 * 3. Render `DocumentCollection` in either `DocumentGalleryCard` grid or `LCSP Data / Table row / reports` table.
 * Failure cases:
 * - Query errors display `TrackingError` with retry; empty list displays `TrackingEmptyState`.
 * Side effects:
 * - Fetches customer tracking reports; `AssessmentReportActions` handles report open/download.
 */
export function TrackingReportsPage() {
  const [mode, setMode] = useState<DocumentViewMode>(
    DOCUMENT_VIEW_MODES.gallery,
  );
  const [search, setSearch] = useState("");
  const [freshness, setFreshness] = useState<TrackingFreshnessStatus>();
  const [offset, setOffset] = useState(0);

  const query = useCustomerTrackingReportsQuery({
    limit: 50,
    offset,
    freshness,
  });
  const data = query.data;

  const filteredItems = useMemo(() => {
    const items = data?.items ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) =>
      [item.assessmentName, item.repositoryOwner, item.repositoryName]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(term)),
    );
  }, [data, search]);

  const totalCount = data?.pagination.total ?? 0;
  const currentCount = (data?.items ?? []).filter(
    (item) => item.freshnessStatus !== TRACKING_FRESHNESS_STATUSES.STALE,
  ).length;
  const staleCount = (data?.items ?? []).filter(
    (item) => item.freshnessStatus === TRACKING_FRESHNESS_STATUSES.STALE,
  ).length;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 lg:px-6">
      <header className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
          {trackingMessage("reportsTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {trackingMessage("reportsDescription")}
        </p>
      </header>

      <section
        aria-label={trackingMessage("reportsTitle")}
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <NextMetricCard
          label={trackingMessage("reportsTotalMetricLabel")}
          value={totalCount.toLocaleString(appLocale)}
          context={trackingMessage("reportsReadyMetricContext")}
          variant={NEXT_METRIC_VARIANTS.ready}
        />
        <NextMetricCard
          label={trackingMessage("reportsCurrentMetricLabel")}
          value={currentCount.toLocaleString(appLocale)}
          context={trackingMessage("reportsReadyMetricLabel")}
        />
        <NextMetricCard
          label={trackingMessage("reportsStaleMetricLabel")}
          value={staleCount.toLocaleString(appLocale)}
          context={trackingMessage("historicalReportWarning")}
        />
      </section>

      <DocumentCollection
        mode={mode}
        onModeChange={setMode}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={trackingMessage("reportsSearchPlaceholder")}
        filters={
          <TrackingFilterSelect
            id="tracking-report-freshness"
            label={trackingMessage("freshness")}
            placeholder={trackingMessage("allFreshness")}
            value={freshness ?? ""}
            options={Object.values(TRACKING_FRESHNESS_STATUSES).map((value) => ({
              value,
              label: trackingMessage(`freshnessState.${value}`),
            }))}
            onValueChange={(value) => {
              setFreshness(
                value ? (value as TrackingFreshnessStatus) : undefined,
              );
              setOffset(0);
            }}
            className="min-w-52"
          />
        }
        isPending={query.isPending}
        isError={query.isError}
        isEmpty={Boolean(data && filteredItems.length === 0)}
        errorSlot={<TrackingError onRetry={() => void query.refetch()} />}
        emptySlot={
          <TrackingEmptyState className="items-center rounded-lg border p-8 text-center">
            {trackingMessage("noReports")}
          </TrackingEmptyState>
        }
        galleryView={
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredItems.map((item) => {
              const repo =
                item.repositoryOwner && item.repositoryName
                  ? `${item.repositoryOwner}/${item.repositoryName}`
                  : trackingMessage("repository");
              return (
                <DocumentGalleryCard
                  key={item.artifactId}
                  title={item.assessmentName}
                  status={
                    <TrackingFreshnessBadge status={item.freshnessStatus} />
                  }
                  badges={<TrackingTrustBadge status={item.trustStatus} />}
                  source={repo}
                  date={formatTrackingDate(item.createdAt)}
                  actions={
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link
                        href={`/assessments/${encodeURIComponent(item.assessmentId)}/report`}
                        className="text-xs font-semibold text-brand hover:underline"
                      >
                        {trackingMessage("reportsOpenReport")}
                      </Link>
                      <AssessmentReportActions
                        assessmentId={item.assessmentId}
                        artifactId={item.artifactId}
                      />
                    </div>
                  }
                />
              );
            })}
          </div>
        }
        listView={
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full min-w-160 border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-accent/60 text-xs font-semibold text-muted-foreground">
                    <th className="px-4 py-2.5">
                      {trackingMessage("colAssessment")}
                    </th>
                    <th className="px-4 py-2.5">
                      {trackingMessage("repository")}
                    </th>
                    <th className="px-4 py-2.5">
                      {trackingMessage("colStatus")}
                    </th>
                    <th className="px-4 py-2.5">
                      {trackingMessage("colLastUpdated")}
                    </th>
                    <th className="px-4 py-2.5 text-right">
                      {trackingMessage("colNextAction")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredItems.map((item) => {
                    const repo =
                      item.repositoryOwner && item.repositoryName
                        ? `${item.repositoryOwner}/${item.repositoryName}`
                        : trackingMessage("repository");
                    return (
                      <tr
                        key={item.artifactId}
                        className="transition-colors hover:bg-muted/35"
                      >
                        <td className="px-4 py-3 font-semibold text-foreground">
                          <Link
                            href={`/assessments/${encodeURIComponent(item.assessmentId)}/report`}
                            className="hover:underline"
                          >
                            {item.assessmentName}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {repo}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            <TrackingFreshnessBadge
                              status={item.freshnessStatus}
                            />
                            <TrackingTrustBadge status={item.trustStatus} />
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                          {formatTrackingDate(item.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <AssessmentReportActions
                            assessmentId={item.assessmentId}
                            artifactId={item.artifactId}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        }
        paginationSlot={
          data ? (
            <TrackingPagination
              total={data.pagination.total}
              limit={data.pagination.limit}
              offset={offset}
              hasMore={data.pagination.hasMore}
              onOffsetChange={setOffset}
            />
          ) : null
        }
      />
    </main>
  );
}
