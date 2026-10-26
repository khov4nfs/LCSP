"use client";

import Link from "next/link";
import { useState } from "react";
import { TRACKING_FRESHNESS_STATUSES, type TrackingFreshnessStatus } from "@lcsp/contracts/assessment-domain";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { appLocale } from "@/lib/locale";
import { useCustomerTrackingReportsQuery } from "@/lib/api/tracking-queries";
import { AssessmentReportActions } from "@/features/assessment-runtime/components/molecules/assessment-report-actions";
import { TrackingFreshnessBadge, TrackingTrustBadge } from "../molecules/tracking-status-badge";
import { TrackingError } from "./tracking-dashboard";

export function TrackingReportsPage() {
  const [freshness, setFreshness] = useState<TrackingFreshnessStatus | "">("");
  const [offset, setOffset] = useState(0);
  const query = useCustomerTrackingReportsQuery({ limit: 50, offset, freshness: freshness || undefined });
  const data = query.data;
  return <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 lg:px-6">
    <header className="space-y-1"><h1 className="font-heading text-2xl font-semibold">{t("reportsTitle")}</h1><p className="text-sm text-muted-foreground">{t("reportsDescription")}</p></header>
    <label className="grid w-fit gap-1 text-sm"><span>{t("freshness")}</span><select className="h-10 min-w-56 rounded-md border bg-background px-3" value={freshness} onChange={(event) => { setFreshness(event.target.value as TrackingFreshnessStatus | ""); setOffset(0); }}>
      <option value="">{t("allFreshness")}</option>{Object.values(TRACKING_FRESHNESS_STATUSES).map((value) => <option key={value} value={value}>{t(`freshnessState.${value}`)}</option>)}
    </select></label>
    {query.isError ? <TrackingError onRetry={() => void query.refetch()} /> : null}
    {query.isPending ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"><Skeleton className="h-48" /><Skeleton className="h-48" /></div> : null}
    {data?.items.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{data.items.map((item) => <Card key={item.artifactId}>
      <CardHeader><CardTitle className="text-base"><Link href={`/assessments/${encodeURIComponent(item.assessmentId)}/report`} className="hover:underline">{item.assessmentName}</Link></CardTitle><p className="text-sm text-muted-foreground">{item.repositoryOwner && item.repositoryName ? `${item.repositoryOwner}/${item.repositoryName}` : t("repository")}</p></CardHeader>
      <CardContent className="flex flex-col gap-3"><TrackingTrustBadge status={item.trustStatus} /><TrackingFreshnessBadge status={item.freshnessStatus} /><p className="text-xs text-muted-foreground">{t("observedAt")}: {item.observedAt ? formatDate(item.observedAt) : t("freshnessState.FRESHNESS_UNKNOWN")}</p>{item.freshnessStatus === TRACKING_FRESHNESS_STATUSES.STALE ? <p className="text-sm text-muted-foreground">{t("historicalReportWarning")}</p> : null}<time className="text-xs text-muted-foreground" dateTime={item.createdAt}>{formatDate(item.createdAt)}</time><AssessmentReportActions assessmentId={item.assessmentId} artifactId={item.artifactId} /></CardContent>
    </Card>)}</div> : data ? <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">{t("noReports")}</p> : null}
    {data && (data.pagination.total > data.pagination.limit || data.pagination.offset > 0) ? <div className="flex justify-end gap-2"><Button variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - data.pagination.limit))}>{t("previousPage")}</Button><Button variant="outline" disabled={!data.pagination.hasMore} onClick={() => setOffset(offset + data.pagination.limit)}>{t("nextPage")}</Button></div> : null}
  </main>;
}

function t(suffix: string) {
  return resolveMessage(appLocale, `pages.workspace.tracking.${suffix}` as MessageKey);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(appLocale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
