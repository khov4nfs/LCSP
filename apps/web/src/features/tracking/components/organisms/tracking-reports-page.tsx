"use client";

import Link from "next/link";
import { useState } from "react";
import {
  TRACKING_FRESHNESS_STATUSES,
  type TrackingFreshnessStatus,
} from "@lcsp/contracts/assessment-domain";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrackingEmptyState } from "../molecules/tracking-empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useCustomerTrackingReportsQuery } from "@/lib/api/tracking-queries";
import { AssessmentReportActions } from "@/features/assessment-runtime/components/molecules/assessment-report-actions";
import { TrackingFilterSelect } from "../molecules/tracking-filter-select";
import { TrackingPagination } from "../molecules/tracking-pagination";
import {
  TrackingFreshnessBadge,
  TrackingTrustBadge,
} from "../molecules/tracking-status-badge";
import { TrackingError } from "../molecules/tracking-error";
import {
  formatTrackingDate,
  trackingMessage,
} from "../../utils/tracking-display";

export function TrackingReportsPage() {
  const [freshness, setFreshness] = useState<TrackingFreshnessStatus>();
  const [offset, setOffset] = useState(0);
  const query = useCustomerTrackingReportsQuery({
    limit: 50,
    offset,
    freshness,
  });
  const data = query.data;
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 lg:px-6">
      <header className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold">
          {trackingMessage("reportsTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {trackingMessage("reportsDescription")}
        </p>
      </header>
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
          setFreshness(value ? (value as TrackingFreshnessStatus) : undefined);
          setOffset(0);
        }}
        className="min-w-56"
      />
      {query.isError ? (
        <TrackingError onRetry={() => void query.refetch()} />
      ) : null}
      {query.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      ) : null}
      {data?.items.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.items.map((item) => (
            <Card key={item.artifactId}>
              <CardHeader>
                <CardTitle className="text-base">
                  <Link
                    href={`/assessments/${encodeURIComponent(item.assessmentId)}/report`}
                    className="hover:underline"
                  >
                    {item.assessmentName}
                  </Link>
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {item.repositoryOwner && item.repositoryName
                    ? `${item.repositoryOwner}/${item.repositoryName}`
                    : trackingMessage("repository")}
                </p>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <TrackingTrustBadge status={item.trustStatus} />
                <TrackingFreshnessBadge status={item.freshnessStatus} />
                <p className="text-xs text-muted-foreground">
                  {trackingMessage("observedAt")}:{" "}
                  {item.observedAt
                    ? formatTrackingDate(item.observedAt)
                    : trackingMessage("freshnessState.FRESHNESS_UNKNOWN")}
                </p>
                {item.freshnessStatus === TRACKING_FRESHNESS_STATUSES.STALE ? (
                  <p className="text-sm text-muted-foreground">
                    {trackingMessage("historicalReportWarning")}
                  </p>
                ) : null}
                <time
                  className="text-xs text-muted-foreground"
                  dateTime={item.createdAt}
                >
                  {formatTrackingDate(item.createdAt)}
                </time>
                <AssessmentReportActions
                  assessmentId={item.assessmentId}
                  artifactId={item.artifactId}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : data ? (
        <TrackingEmptyState className="items-center rounded-lg border p-8 text-center">
          {trackingMessage("noReports")}
        </TrackingEmptyState>
      ) : null}
      {data ? (
        <TrackingPagination
          total={data.pagination.total}
          limit={data.pagination.limit}
          offset={offset}
          hasMore={data.pagination.hasMore}
          onOffsetChange={setOffset}
        />
      ) : null}
    </main>
  );
}
