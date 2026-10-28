"use client";

import { useDeferredValue, useState } from "react";
import { SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCustomerTrackingOverviewQuery } from "@/lib/api/tracking-queries";
import { TrackingEmptyState } from "../molecules/tracking-empty-state";
import { AssessmentTrackingCard } from "../molecules/assessment-tracking-card";
import { TrackingError } from "../molecules/tracking-error";
import { TrackingPagination } from "../molecules/tracking-pagination";
import { trackingMessage } from "../../utils/tracking-display";

export function TrackingAssessmentsPage() {
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const deferredSearch = useDeferredValue(search.trim());
  const query = useCustomerTrackingOverviewQuery(deferredSearch, offset);
  const data = query.data;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 lg:px-6">
      <header className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold">
          {trackingMessage("assessmentsTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {trackingMessage("assessmentsDescription")}
        </p>
      </header>
      <label className="relative block max-w-md">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setOffset(0);
          }}
          aria-label={trackingMessage("searchLabel")}
          placeholder={trackingMessage("searchPlaceholder")}
          className="pl-9"
        />
      </label>
      {query.isError ? (
        <TrackingError onRetry={() => void query.refetch()} />
      ) : null}
      {query.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      ) : null}
      {data && data.assessments.length ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.assessments.map((item) => (
              <AssessmentTrackingCard key={item.assessmentId} item={item} />
            ))}
          </div>
          <TrackingPagination
            total={data.pagination.total}
            limit={data.pagination.limit}
            offset={offset}
            hasMore={data.pagination.hasMore}
            onOffsetChange={setOffset}
            showTotal
          />
        </>
      ) : data ? (
        <TrackingEmptyState className="items-center rounded-lg border p-8 text-center">
          {trackingMessage("noAssessments")}
        </TrackingEmptyState>
      ) : null}
    </main>
  );
}
