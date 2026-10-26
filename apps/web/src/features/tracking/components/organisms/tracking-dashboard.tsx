"use client";

import Link from "next/link";
import {
  TRACKING_FRESHNESS_STATUSES,
  TRACKING_RULE_OUTCOMES,
  type CustomerTrackingAssessmentItem,
} from "@lcsp/contracts/assessment-domain";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import { ArrowRightIcon, RefreshCwIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import {
  TrackingFreshnessBadge,
  TrackingNotEvaluatedBadge,
  TrackingOutcomeBadge,
  TrackingTrustBadge,
} from "../molecules/tracking-status-badge";

export function TrackingDashboard() {
  const overview = useCustomerTrackingOverviewQuery();
  const obligations = useCustomerTrackingObligationsQuery({ limit: 5, needsAttention: true });
  const reports = useCustomerTrackingReportsQuery({ limit: 3 });
  const data = overview.data;
  if (overview.isPending && !data) {
    return <div className="flex flex-col gap-6" aria-label={t("loading")}><Skeleton className="h-48 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <div className="flex flex-col gap-6">
      {overview.isError ? <TrackingError onRetry={() => void overview.refetch()} /> : null}

      {data ? <>
        <TrackingSection title={t("actionsTitle")} description={t("actionsDescription")} compact={!data.actions.length}>
          {data.actions.length ? <div className="flex flex-col divide-y">
            {data.actions.map((item) => <Link key={item.requestId}
              href={`/assessments/${encodeURIComponent(item.assessmentId)}?requestId=${encodeURIComponent(item.requestId)}`}
              className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0 hover:text-primary">
              <span className="min-w-0"><strong className="block font-medium">{item.assessmentName}</strong><span className="mt-1 block text-sm text-muted-foreground">{item.question}</span></span>
              <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium">{t("answer")}<ArrowRightIcon className="size-4" /></span>
            </Link>)}
          </div> : <p className="text-sm text-muted-foreground">{t("noActions")}</p>}
        </TrackingSection>

        <TrackingSection title={t("changesTitle")} description={t("changesDescription")} compact={!data.changes.length}>
          {data.changes.length ? <div className="flex flex-col divide-y">
            {data.changes.map((item, index) => {
              return <Link key={`${item.assessmentId}-${item.changeType}-${index}`} href={item.destinationUrl} className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[1fr_auto]">
                <span className="font-medium">{item.title}</span>
                <time className="text-xs text-muted-foreground sm:text-right" dateTime={item.occurredAt}>{formatDate(item.occurredAt)}</time>
                <span className="text-sm text-muted-foreground sm:col-span-2">{item.description}</span>
              </Link>;
            })}
          </div> : <p className="text-sm text-muted-foreground">{t("noChanges")}</p>}
        </TrackingSection>

        <TrackingSection title={t("assessmentsTitle")} description={t("assessmentsDescription")} action={<Button render={<Link href="/assessments" />} variant="outline" nativeButton={false}>{t("viewAll")}</Button>}>
          {data.assessments.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.assessments.slice(0, 6).map((item) => <AssessmentTrackingCard key={item.assessmentId} item={item} />)}
          </div> : <p className="text-sm text-muted-foreground">{t("noAssessments")}</p>}
        </TrackingSection>

        <TrackingSection title={t("obligationsTitle")} description={t("obligationsDescription")} action={<Button render={<Link href="/workspace/compliance" />} variant="outline" nativeButton={false}>{t("viewAll")}</Button>}>
          {obligations.isError ? <TrackingError onRetry={() => void obligations.refetch()} /> : obligations.isPending ? <Skeleton className="h-24 w-full" /> : obligations.data?.items.length ? <div className="flex flex-col divide-y">
            {obligations.data.items.map((item) => <div key={`${item.ruleSetVersionId}-${item.assessmentRuleId}`} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div><p className="font-medium">{item.concept}</p><p className="text-xs text-muted-foreground">{item.ruleSetVersion ?? item.ruleSetVersionId}</p></div>
              <div className="flex flex-wrap gap-2">{item.nonCompliantCount > 0 ? <TrackingOutcomeBadge outcome={TRACKING_RULE_OUTCOMES.NON_COMPLIANT} /> : null}<span className="text-sm text-muted-foreground">{item.affectedAssessmentCount}</span></div>
            </div>)}
          </div> : obligations.data?.evaluationSummary.notEvaluatedAssessmentCount ? <div className="space-y-2"><p className="text-sm text-muted-foreground">{obligations.data.evaluationSummary.notEvaluatedAssessmentCount.toLocaleString(appLocale)} {t("notEvaluatedCount")}</p><Link className="inline-flex min-h-10 items-center rounded-md text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="/assessments">{t("reviewAssessments")}</Link></div> : <p className="text-sm text-muted-foreground">{t("noObligations")}</p>}
          {obligations.data && obligations.data.items.length > 0 && obligations.data.evaluationSummary.notEvaluatedAssessmentCount > 0 ? <p className="pt-3 text-sm text-muted-foreground">{obligations.data.evaluationSummary.notEvaluatedAssessmentCount.toLocaleString(appLocale)} {t("notEvaluatedCount")} <Link className="underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="/assessments">{t("reviewAssessments")}</Link></p> : null}
        </TrackingSection>

        <TrackingSection title={t("reportsTitle")} description={t("reportsDescription")} action={<Button render={<Link href="/workspace/reports" />} variant="outline" nativeButton={false}>{t("viewAll")}</Button>}>
          {reports.isError ? <TrackingError onRetry={() => void reports.refetch()} /> : reports.isPending ? <Skeleton className="h-24 w-full" /> : reports.data?.items.length ? <div className="grid gap-4 lg:grid-cols-2">
            {reports.data.items.map((item) => <Card key={item.artifactId}>
              <CardHeader><CardTitle className="text-base">{item.assessmentName}</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-3"><TrackingFreshnessBadge status={item.freshnessStatus} />{item.freshnessStatus === TRACKING_FRESHNESS_STATUSES.STALE ? <p className="text-sm text-muted-foreground">{t("historicalReportWarning")}</p> : null}<AssessmentReportActions assessmentId={item.assessmentId} artifactId={item.artifactId} /></CardContent>
            </Card>)}
          </div> : <p className="text-sm text-muted-foreground">{t("noReports")}</p>}
        </TrackingSection>
      </> : null}
    </div>
  );
}

export function AssessmentTrackingCard({ item }: { item: CustomerTrackingAssessmentItem }) {
  return <Card className="min-w-0">
    <CardHeader className="space-y-2">
      <CardTitle className="text-base"><Link className="hover:underline" href={`/assessments/${encodeURIComponent(item.assessmentId)}`}>{item.name}</Link></CardTitle>
      <p className="truncate text-xs text-muted-foreground">{item.repository.owner && item.repository.name ? `${item.repository.owner}/${item.repository.name}` : t("repository")}</p>
    </CardHeader>
    <CardContent className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t(summaryKey(item))}</p>
      <div className="flex flex-wrap gap-2">
        {item.compliance.compliantCount > 0 ? <TrackingOutcomeBadge outcome={TRACKING_RULE_OUTCOMES.COMPLIANT} /> : null}
        {item.compliance.nonCompliantCount > 0 ? <TrackingOutcomeBadge outcome={TRACKING_RULE_OUTCOMES.NON_COMPLIANT} /> : null}
        {item.compliance.notApplicableCount > 0 ? <TrackingOutcomeBadge outcome={TRACKING_RULE_OUTCOMES.NOT_APPLICABLE} /> : null}
        {!item.ruleSet.ruleSetVersionId ? <TrackingNotEvaluatedBadge /> : item.compliance.unresolvedCount > 0 ? <TrackingOutcomeBadge outcome={TRACKING_RULE_OUTCOMES.UNRESOLVED} /> : null}
        {item.ruleSet.ruleSetVersionId && Object.values(item.compliance).every((value) => value === 0) ? <TrackingOutcomeBadge outcome={TRACKING_RULE_OUTCOMES.UNRESOLVED} /> : null}
      </div>
      <TrackingTrustBadge status={item.trust.trustStatus} />
      <TrackingFreshnessBadge status={item.repository.freshnessStatus} />
      <details className="rounded-md border px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium">{t("detail")}</summary>
        <dl className="mt-2 space-y-2 text-xs">
          <Fact label={t("assessedCommit")} value={item.repository.pinnedCommit} />
          <Fact label={t("latestObservedCommit")} value={item.repository.latestCommit} />
          <Fact label={t("ruleSet")} value={item.ruleSet.ruleSetVersion ?? item.ruleSet.ruleSetName} />
          <Fact label={t("observedAt")} value={item.repository.observedAt ? formatDate(item.repository.observedAt) : t("freshnessState.FRESHNESS_UNKNOWN")} />
        </dl>
      </details>
      {item.report.isReady ? <AssessmentReportActions assessmentId={item.assessmentId} artifactId={item.report.finalReportArtifactId!} /> : <Button render={<Link href={`/assessments/${encodeURIComponent(item.assessmentId)}`} />} variant="outline" nativeButton={false}>{t("openAssessment")}</Button>}
    </CardContent>
  </Card>;
}

export function TrackingError({ onRetry }: { onRetry: () => void }) {
  return <Alert variant="destructive"><AlertTitle>{t("errorTitle")}</AlertTitle><AlertDescription className="flex flex-wrap items-center justify-between gap-3"><span>{t("errorDescription")}</span><Button onClick={onRetry} variant="outline" size="sm"><RefreshCwIcon className="size-4" />{t("retry")}</Button></AlertDescription></Alert>;
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{label}</dt><dd className="max-w-3/5 break-all text-right">{value ?? t("notAvailable")}</dd></div>;
}

function t(suffix: string) {
  return resolveMessage(appLocale, `pages.workspace.tracking.${suffix}` as MessageKey);
}

function summaryKey(item: CustomerTrackingAssessmentItem) {
  if (!item.ruleSet.ruleSetVersionId) return "summary.notEvaluated";
  if (item.compliance.nonCompliantCount > 0) return "summary.nonCompliant";
  if (item.compliance.unresolvedCount > 0 || Object.values(item.compliance).every((value) => value === 0)) return "summary.unresolved";
  if (item.compliance.compliantCount === 0) return "summary.notApplicable";
  return "summary.compliant";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(appLocale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
