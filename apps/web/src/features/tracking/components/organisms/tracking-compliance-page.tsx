"use client";

import Link from "next/link";
import { useState } from "react";
import {
  TRACKING_FRESHNESS_STATUSES,
  TRACKING_RULE_OUTCOMES,
  type TrackingFreshnessStatus,
  type TrackingRuleOutcome,
} from "@lcsp/contracts/assessment-domain";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { appLocale } from "@/lib/locale";
import { useCustomerTrackingObligationsQuery } from "@/lib/api/tracking-queries";
import { TrackingSection } from "../molecules/tracking-section";
import { TrackingError } from "../molecules/tracking-error";
import { TrackingOutcomeBadge } from "../molecules/tracking-status-badge";
import { TrackingObligationAssessments } from "../molecules/tracking-obligation-assessments";
import { TrackingEmptyState } from "../molecules/tracking-empty-state";
import { TrackingFilterSelect } from "../molecules/tracking-filter-select";
import { TrackingPagination } from "../molecules/tracking-pagination";
import { trackingMessage } from "../../utils/tracking-display";

export function TrackingCompliancePage() {
  const [outcome, setOutcome] = useState<TrackingRuleOutcome>();
  const [freshness, setFreshness] = useState<TrackingFreshnessStatus>();
  const [offset, setOffset] = useState(0);
  const query = useCustomerTrackingObligationsQuery({
    limit: 50,
    offset,
    outcome,
    freshness,
  });
  const data = query.data;
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 lg:px-6">
      <header className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold">
          {trackingMessage("obligationsTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {trackingMessage("obligationsDescription")}
        </p>
      </header>
      <div className="flex flex-wrap gap-3">
        <TrackingFilterSelect
          id="tracking-compliance-outcome"
          label={trackingMessage("filterOutcome")}
          placeholder={trackingMessage("allOutcomes")}
          value={outcome ?? ""}
          options={Object.values(TRACKING_RULE_OUTCOMES).map((value) => ({
            value,
            label: trackingMessage(`outcome.${value}`),
          }))}
          onValueChange={(value) => {
            setOutcome(value ? (value as TrackingRuleOutcome) : undefined);
            setOffset(0);
          }}
          className="min-w-48"
        />
        <TrackingFilterSelect
          id="tracking-compliance-freshness"
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
      </div>
      {query.isError ? (
        <TrackingError onRetry={() => void query.refetch()} />
      ) : null}
      {query.isPending ? <Skeleton className="h-72" /> : null}
      {data && data.evaluationSummary.notEvaluatedAssessmentCount > 0 ? (
        <div
          className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4"
          role="status"
        >
          <p className="font-medium">
            {data.evaluationSummary.notEvaluatedAssessmentCount.toLocaleString(
              appLocale,
            )}{" "}
            {trackingMessage("notEvaluatedCount")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {trackingMessage("notEvaluatedDescription")}
          </p>
          <Button
            render={<Link href="/assessments" />}
            variant="link"
            nativeButton={false}
            className="mt-2 h-auto self-start p-0"
          >
            {trackingMessage("reviewAssessments")}
          </Button>
        </div>
      ) : null}
      {data ? (
        <TrackingSection
          title={trackingMessage("obligationsTitle")}
          description={`${trackingMessage("portfolioCount")}: ${data.pagination.total.toLocaleString(appLocale)}`}
        >
          {data.items.length ? (
            <div className="flex flex-col divide-y">
              {data.items.map((item) => (
                <article
                  key={`${item.ruleSetVersionId}-${item.assessmentRuleId}`}
                  className="grid gap-4 py-4 first:pt-0 last:pb-0 lg:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <div className="min-w-0">
                    <h2 className="font-medium">{item.concept}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {trackingMessage("ruleSet")}:{" "}
                      {item.ruleSetVersion ?? item.ruleSetVersionId}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {item.compliantCount > 0 ? (
                        <TrackingOutcomeBadge
                          outcome={TRACKING_RULE_OUTCOMES.COMPLIANT}
                        />
                      ) : null}
                      {item.nonCompliantCount > 0 ? (
                        <TrackingOutcomeBadge
                          outcome={TRACKING_RULE_OUTCOMES.NON_COMPLIANT}
                        />
                      ) : null}
                      {item.notApplicableCount > 0 ? (
                        <TrackingOutcomeBadge
                          outcome={TRACKING_RULE_OUTCOMES.NOT_APPLICABLE}
                        />
                      ) : null}
                      {item.unresolvedCount > 0 ? (
                        <TrackingOutcomeBadge
                          outcome={TRACKING_RULE_OUTCOMES.UNRESOLVED}
                        />
                      ) : null}
                    </div>
                  </div>
                  <TrackingObligationAssessments
                    ruleSetVersionId={item.ruleSetVersionId}
                    assessmentRuleId={item.assessmentRuleId}
                    assessments={item.assessments}
                    affectedAssessmentCount={item.affectedAssessmentCount}
                    outcome={outcome}
                    freshness={freshness}
                  />
                </article>
              ))}
            </div>
          ) : (
            <TrackingEmptyState className="py-6">
              {data.evaluationSummary.notEvaluatedAssessmentCount > 0
                ? trackingMessage("notEvaluatedDescription")
                : trackingMessage("noObligations")}
            </TrackingEmptyState>
          )}
        </TrackingSection>
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
