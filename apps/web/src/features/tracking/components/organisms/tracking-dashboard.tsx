"use client";

import Link from "next/link";
import {
  TRACKING_FRESHNESS_STATUSES,
  TRACKING_RULE_OUTCOMES,
} from "@lcsp/contracts/assessment-domain";
import { ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { appLocale } from "@/lib/locale";
import {
  useCustomerTrackingObligationsQuery,
  useCustomerTrackingOverviewQuery,
  useCustomerTrackingReportsQuery,
} from "@/lib/api/tracking-queries";
import { AssessmentReportActions } from "@/features/assessment-runtime/components/molecules/assessment-report-actions";
import { TrackingSection } from "../molecules/tracking-section";
import { TrackingEmptyState } from "../molecules/tracking-empty-state";
import {
  TrackingFreshnessBadge,
  TrackingOutcomeBadge,
} from "../molecules/tracking-status-badge";
import { AssessmentTrackingCard } from "../molecules/assessment-tracking-card";
import { TrackingError } from "../molecules/tracking-error";
import {
  formatTrackingDate,
  trackingMessage,
} from "../../utils/tracking-display";

export function TrackingDashboard() {
  const overview = useCustomerTrackingOverviewQuery();
  const obligations = useCustomerTrackingObligationsQuery({
    limit: 5,
    needsAttention: true,
  });
  const reports = useCustomerTrackingReportsQuery({ limit: 3 });
  const data = overview.data;
  if (overview.isPending && !data) {
    return (
      <div
        className="flex flex-col gap-6"
        aria-label={trackingMessage("loading")}
      >
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {overview.isError ? (
        <TrackingError onRetry={() => void overview.refetch()} />
      ) : null}

      {data ? (
        <>
          <TrackingSection
            title={trackingMessage("actionsTitle")}
            description={trackingMessage("actionsDescription")}
            compact={!data.actions.length}
          >
            {data.actions.length ? (
              <div className="flex flex-col divide-y">
                {data.actions.map((item) => (
                  <Link
                    key={item.requestId}
                    href={`/assessments/${encodeURIComponent(item.assessmentId)}?requestId=${encodeURIComponent(item.requestId)}`}
                    className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0 hover:text-primary"
                  >
                    <span className="min-w-0">
                      <strong className="block font-medium">
                        {item.assessmentName}
                      </strong>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {item.question}
                      </span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium">
                      {trackingMessage("answer")}
                      <ArrowRightIcon className="size-4" />
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <TrackingEmptyState>
                {trackingMessage("noActions")}
              </TrackingEmptyState>
            )}
          </TrackingSection>

          <TrackingSection
            title={trackingMessage("changesTitle")}
            description={trackingMessage("changesDescription")}
            compact={!data.changes.length}
          >
            {data.changes.length ? (
              <div className="flex flex-col divide-y">
                {data.changes.map((item, index) => {
                  return (
                    <Link
                      key={`${item.assessmentId}-${item.changeType}-${index}`}
                      href={item.destinationUrl}
                      className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[1fr_auto]"
                    >
                      <span className="font-medium">{item.title}</span>
                      <time
                        className="text-xs text-muted-foreground sm:text-right"
                        dateTime={item.occurredAt}
                      >
                        {formatTrackingDate(item.occurredAt)}
                      </time>
                      <span className="text-sm text-muted-foreground sm:col-span-2">
                        {item.description}
                      </span>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <TrackingEmptyState>
                {trackingMessage("noChanges")}
              </TrackingEmptyState>
            )}
          </TrackingSection>

          <TrackingSection
            title={trackingMessage("assessmentsTitle")}
            description={trackingMessage("assessmentsDescription")}
            action={
              <Button
                render={<Link href="/assessments" />}
                variant="outline"
                nativeButton={false}
              >
                {trackingMessage("viewAll")}
              </Button>
            }
          >
            {data.assessments.length ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {data.assessments.slice(0, 6).map((item) => (
                  <AssessmentTrackingCard key={item.assessmentId} item={item} />
                ))}
              </div>
            ) : (
              <TrackingEmptyState>
                {trackingMessage("noAssessments")}
              </TrackingEmptyState>
            )}
          </TrackingSection>

          <TrackingSection
            title={trackingMessage("obligationsTitle")}
            description={trackingMessage("obligationsDescription")}
            action={
              <Button
                render={<Link href="/workspace/compliance" />}
                variant="outline"
                nativeButton={false}
              >
                {trackingMessage("viewAll")}
              </Button>
            }
          >
            {obligations.isError ? (
              <TrackingError onRetry={() => void obligations.refetch()} />
            ) : obligations.isPending ? (
              <Skeleton className="h-24 w-full" />
            ) : obligations.data?.items.length ? (
              <div className="flex flex-col divide-y">
                {obligations.data.items.map((item) => (
                  <div
                    key={`${item.ruleSetVersionId}-${item.assessmentRuleId}`}
                    className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div>
                      <p className="font-medium">{item.concept}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.ruleSetVersion ?? item.ruleSetVersionId}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {item.nonCompliantCount > 0 ? (
                        <TrackingOutcomeBadge
                          outcome={TRACKING_RULE_OUTCOMES.NON_COMPLIANT}
                        />
                      ) : null}
                      <span className="text-sm text-muted-foreground">
                        {item.affectedAssessmentCount}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : obligations.data?.evaluationSummary
                .notEvaluatedAssessmentCount ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {obligations.data.evaluationSummary.notEvaluatedAssessmentCount.toLocaleString(
                    appLocale,
                  )}{" "}
                  {trackingMessage("notEvaluatedCount")}
                </p>
                <Button
                  render={<Link href="/assessments" />}
                  variant="link"
                  nativeButton={false}
                  className="h-auto self-start p-0"
                >
                  {trackingMessage("reviewAssessments")}
                </Button>
              </div>
            ) : (
              <TrackingEmptyState>
                {trackingMessage("noObligations")}
              </TrackingEmptyState>
            )}
            {obligations.data &&
            obligations.data.items.length > 0 &&
            obligations.data.evaluationSummary.notEvaluatedAssessmentCount >
              0 ? (
              <p className="pt-3 text-sm text-muted-foreground">
                {obligations.data.evaluationSummary.notEvaluatedAssessmentCount.toLocaleString(
                  appLocale,
                )}{" "}
                {trackingMessage("notEvaluatedCount")}{" "}
                <Link
                  className="underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  href="/assessments"
                >
                  {trackingMessage("reviewAssessments")}
                </Link>
              </p>
            ) : null}
          </TrackingSection>

          <TrackingSection
            title={trackingMessage("reportsTitle")}
            description={trackingMessage("reportsDescription")}
            action={
              <Button
                render={<Link href="/workspace/reports" />}
                variant="outline"
                nativeButton={false}
              >
                {trackingMessage("viewAll")}
              </Button>
            }
          >
            {reports.isError ? (
              <TrackingError onRetry={() => void reports.refetch()} />
            ) : reports.isPending ? (
              <Skeleton className="h-24 w-full" />
            ) : reports.data?.items.length ? (
              <div className="grid gap-4 lg:grid-cols-2">
                {reports.data.items.map((item) => (
                  <Card key={item.artifactId}>
                    <CardHeader>
                      <CardTitle className="text-base">
                        {item.assessmentName}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                      <TrackingFreshnessBadge status={item.freshnessStatus} />
                      {item.freshnessStatus ===
                      TRACKING_FRESHNESS_STATUSES.STALE ? (
                        <p className="text-sm text-muted-foreground">
                          {trackingMessage("historicalReportWarning")}
                        </p>
                      ) : null}
                      <AssessmentReportActions
                        assessmentId={item.assessmentId}
                        artifactId={item.artifactId}
                      />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <TrackingEmptyState>
                {trackingMessage("noReports")}
              </TrackingEmptyState>
            )}
          </TrackingSection>
        </>
      ) : null}
    </div>
  );
}
