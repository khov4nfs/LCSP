"use client";

import Link from "next/link";
import { useState } from "react";
import {
  TRACKING_FRESHNESS_STATUSES,
  TRACKING_RULE_OUTCOMES,
  type TrackingFreshnessStatus,
  type TrackingRuleOutcome,
} from "@lcsp/contracts/assessment-domain";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { appLocale } from "@/lib/locale";
import { useCustomerTrackingObligationsQuery } from "@/lib/api/tracking-queries";
import { TrackingSection } from "../molecules/tracking-section";
import { TrackingError } from "./tracking-dashboard";
import { TrackingFreshnessBadge, TrackingOutcomeBadge, TrackingTrustBadge } from "../molecules/tracking-status-badge";

export function TrackingCompliancePage() {
  const [outcome, setOutcome] = useState<TrackingRuleOutcome | "">("");
  const [freshness, setFreshness] = useState<TrackingFreshnessStatus | "">("");
  const [offset, setOffset] = useState(0);
  const query = useCustomerTrackingObligationsQuery({ limit: 50, offset, outcome: outcome || undefined, freshness: freshness || undefined });
  const data = query.data;
  return <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 lg:px-6">
    <header className="space-y-1"><h1 className="font-heading text-2xl font-semibold">{t("obligationsTitle")}</h1><p className="text-sm text-muted-foreground">{t("obligationsDescription")}</p></header>
    <div className="flex flex-wrap gap-3">
      <label className="grid gap-1 text-sm"><span>{t("filterOutcome")}</span><select className="h-10 min-w-48 rounded-md border bg-background px-3" value={outcome} onChange={(event) => { setOutcome(event.target.value as TrackingRuleOutcome | ""); setOffset(0); }}>
        <option value="">{t("allOutcomes")}</option>{Object.values(TRACKING_RULE_OUTCOMES).map((value) => <option key={value} value={value}>{t(`outcome.${value}`)}</option>)}
      </select></label>
      <label className="grid gap-1 text-sm"><span>{t("freshness")}</span><select className="h-10 min-w-52 rounded-md border bg-background px-3" value={freshness} onChange={(event) => { setFreshness(event.target.value as TrackingFreshnessStatus | ""); setOffset(0); }}>
        <option value="">{t("allFreshness")}</option>{Object.values(TRACKING_FRESHNESS_STATUSES).map((value) => <option key={value} value={value}>{t(`freshnessState.${value}`)}</option>)}
      </select></label>
    </div>
    {query.isError ? <TrackingError onRetry={() => void query.refetch()} /> : null}
    {query.isPending ? <Skeleton className="h-72" /> : null}
    {data ? <TrackingSection title={t("obligationsTitle")} description={`${t("portfolioCount")}: ${data.pagination.total.toLocaleString(appLocale)}`}>
      {data.items.length ? <div className="flex flex-col divide-y">{data.items.map((item) => <article key={`${item.ruleSetVersionId}-${item.assessmentRuleId}`} className="grid gap-4 py-4 first:pt-0 last:pb-0 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0"><h2 className="font-medium">{item.concept}</h2><p className="mt-1 text-xs text-muted-foreground">{t("ruleSet")}: {item.ruleSetVersion ?? item.ruleSetVersionId}</p><div className="mt-3 flex flex-wrap gap-2">
          {item.compliantCount > 0 ? <TrackingOutcomeBadge outcome={TRACKING_RULE_OUTCOMES.COMPLIANT} /> : null}
          {item.nonCompliantCount > 0 ? <TrackingOutcomeBadge outcome={TRACKING_RULE_OUTCOMES.NON_COMPLIANT} /> : null}
          {item.notApplicableCount > 0 ? <TrackingOutcomeBadge outcome={TRACKING_RULE_OUTCOMES.NOT_APPLICABLE} /> : null}
          {item.unresolvedCount > 0 ? <TrackingOutcomeBadge outcome={TRACKING_RULE_OUTCOMES.UNRESOLVED} /> : null}
        </div></div>
        <div className="flex flex-col gap-2 lg:min-w-80">{item.assessments.map((assessment) => <Link key={assessment.assessmentId} href={`/assessments/${encodeURIComponent(assessment.assessmentId)}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm hover:bg-muted">
          <span className="min-w-0 truncate font-medium">{assessment.assessmentName}</span><span className="flex flex-col items-end gap-1"><span className="flex flex-wrap gap-1"><TrackingOutcomeBadge outcome={assessment.outcome} /><TrackingFreshnessBadge status={assessment.freshnessStatus} /><TrackingTrustBadge status={assessment.trustStatus} /></span><span className="text-xs text-muted-foreground">{t("observedAt")}: {assessment.observedAt ? formatDate(assessment.observedAt) : t("freshnessState.FRESHNESS_UNKNOWN")}</span></span>
        </Link>)}{item.affectedAssessmentCount > item.assessments.length ? <span className="text-xs text-muted-foreground">{(item.affectedAssessmentCount - item.assessments.length).toLocaleString(appLocale)} {t("moreAssessments")}</span> : null}</div>
      </article>)}</div> : <p className="py-6 text-sm text-muted-foreground">{t("noObligations")}</p>}
    </TrackingSection> : null}
    {data ? <div className="flex items-center justify-end gap-2">
      <Button variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - data.pagination.limit))}>{t("previousPage")}</Button>
      <Button variant="outline" disabled={!data.pagination.hasMore} onClick={() => setOffset(offset + data.pagination.limit)}>{t("nextPage")}</Button>
    </div> : null}
  </main>;
}

function t(suffix: string) {
  return resolveMessage(appLocale, `pages.workspace.tracking.${suffix}` as MessageKey);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(appLocale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
