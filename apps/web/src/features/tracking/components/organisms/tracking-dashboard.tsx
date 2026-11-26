"use client";

import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCustomerTrackingOverviewQuery,
  useCustomerTrackingReportsQuery,
} from "@/lib/api/tracking-queries";
import { DashboardBento } from "./dashboard-bento";
import { TrackingError } from "../molecules/tracking-error";
import { trackingMessage } from "../../utils/tracking-display";

/**
 * Business purpose:
 * Orchestrate customer tracking data fetching and present the bento intelligence
 * dashboard with loading, error, stale, empty, sparse, and populated states.
 *
 * Business rules:
 * - Never fabricate backend success; render explicit error and retry UI on failure.
 * - Reconcile report-ready counts from the reports query when available, falling back
 *   to overview assessment readiness flags only when reports have not loaded yet.
 *
 * Execution flow:
 * 1. Query tracking overview for the current pagination offset and ready reports summary.
 * 2. Show skeleton placeholders during initial pending load.
 * 3. Render error banner with retry when overview fails; render DashboardBento when data exists.
 *
 * Failure cases:
 * - Overview query failure renders TrackingError with refetch trigger while preserving any stale data.
 *
 * Side effects:
 * - Triggers read-only BFF queries via TanStack Query hooks.
 */
export function TrackingDashboard() {
  const [offset, setOffset] = useState(0);
  const overview = useCustomerTrackingOverviewQuery("", offset);
  const reports = useCustomerTrackingReportsQuery({ limit: 3 });
  const data = overview.data;

  if (overview.isPending && !data) {
    return (
      <div
        className="flex flex-col gap-6"
        aria-label={trackingMessage("loading")}
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Skeleton className="h-92 rounded-2xl lg:col-span-7" />
          <Skeleton className="h-92 rounded-2xl lg:col-span-5" />
        </div>
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );
  }

  const reportsReadyCount =
    reports.data?.pagination.total ??
    data?.assessments.filter((item) => item.report.isReady).length ??
    0;

  return (
    <div className="flex flex-col gap-6">
      {overview.isError ? (
        <TrackingError onRetry={() => void overview.refetch()} />
      ) : null}

      {data ? (
        <DashboardBento
          overview={data}
          reportsReadyCount={reportsReadyCount}
          onOffsetChange={setOffset}
        />
      ) : null}
    </div>
  );
}
