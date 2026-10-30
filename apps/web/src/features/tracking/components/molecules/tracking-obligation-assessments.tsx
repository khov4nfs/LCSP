"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { appLocale } from "@/lib/locale";
import { useCustomerTrackingObligationAssessmentsPages } from "@/lib/api/tracking-queries";
import {
  formatTrackingDate,
  trackingMessage,
} from "../../utils/tracking-display";
import type { TrackingObligationAssessmentsProps } from "../../types/tracking-ui.types";
import {
  TrackingFreshnessBadge,
  TrackingOutcomeBadge,
  TrackingTrustBadge,
} from "./tracking-status-badge";

export function TrackingObligationAssessments({
  ruleSetVersionId,
  assessmentRuleId,
  assessments,
  affectedAssessmentCount,
  outcome,
  freshness,
}: TrackingObligationAssessmentsProps) {
  const [expanded, setExpanded] = useState(false);
  const query = useCustomerTrackingObligationAssessmentsPages(
    { ruleSetVersionId, assessmentRuleId, outcome, freshness, limit: 20 },
    assessments.length,
    expanded,
  );
  const additionalAssessments =
    query.data?.pages.flatMap((page) => page.items) ?? [];
  const visibleAssessments = [...assessments, ...additionalAssessments];
  const hasMore =
    query.data?.pages.at(-1)?.pagination.hasMore ??
    visibleAssessments.length < affectedAssessmentCount;

  return (
    <div className="flex flex-col gap-2 lg:min-w-80">
      {visibleAssessments.map((assessment) => (
        <Link
          key={assessment.assessmentId}
          href={`/assessments/${encodeURIComponent(assessment.assessmentId)}`}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="min-w-0 truncate font-medium">
            {assessment.assessmentName}
          </span>
          <span className="flex flex-col items-end gap-1">
            <span className="flex flex-wrap gap-1">
              <TrackingOutcomeBadge outcome={assessment.outcome} />
              <TrackingFreshnessBadge status={assessment.freshnessStatus} />
              <TrackingTrustBadge status={assessment.trustStatus} />
            </span>
            <span className="text-xs text-muted-foreground">
              {trackingMessage("observedAt")}:{" "}
              {assessment.observedAt
                ? formatTrackingDate(assessment.observedAt)
                : trackingMessage("freshnessState.FRESHNESS_UNKNOWN")}
            </span>
          </span>
        </Link>
      ))}
      {hasMore ? (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          disabled={query.isFetchingNextPage}
          onClick={() => {
            if (!expanded) setExpanded(true);
            else void query.fetchNextPage();
          }}
        >
          {query.isFetchingNextPage
            ? trackingMessage("loading")
            : trackingMessage("loadMoreAssessments")}
        </Button>
      ) : null}
      {query.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {trackingMessage("errorDescription")}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {visibleAssessments.length.toLocaleString(appLocale)} /{" "}
        {affectedAssessmentCount.toLocaleString(appLocale)}
      </p>
    </div>
  );
}
