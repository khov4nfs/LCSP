"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { TrackingUntrustedReason } from "@lcsp/contracts/assessment-domain";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrackingSection } from "../molecules/tracking-section";
import { appLocale } from "@/lib/locale";
import { useAdminTrackingOperationalQuery } from "@/lib/api/tracking-queries";
import { TrackingError } from "./tracking-dashboard";

export function AdminTrackingPage() {
  const query = useAdminTrackingOperationalQuery();
  const data = query.data;
  return <div className="space-y-6">
    <header className="space-y-1"><h1 className="font-heading text-2xl font-semibold">{t("adminTitle")}</h1><p className="text-sm text-muted-foreground">{t("adminDescription")}</p></header>
    {query.isError ? <TrackingError onRetry={() => void query.refetch()} /> : null}
    {query.isPending ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton className="h-28" key={i} />)}</div> : null}
    {data ? <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label={t("failedAssessments")} value={data.platformHealth.totalFailedAssessments} />
        <Metric label={t("blockedAssessments")} value={data.platformHealth.totalBlockedAssessments} />
        <Metric label={t("executions")} value={data.platformHealth.totalExecutionAnomalies} />
        <Metric label={t("usage")} value={data.platformHealth.totalUnreconciledUsageEvents} />
        <Metric label={t("untrusted")} value={data.platformHealth.totalUntrustedProjections} />
      </div>
      <p className="text-xs text-muted-foreground">{t("limitedRows")} {t("generatedAt")}: {formatDate(data.generatedAt)}</p>
      <TrackingSection title={t("customerImpact")}>
        {data.impactedAssessments.length ? <Rows>{data.impactedAssessments.map((item) => <article key={item.assessmentId} className="rounded-lg border p-3">
          <p className="font-medium">{item.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("affectedCustomer")}: {item.ownerId}</p>
          <details className="mt-2 text-sm"><summary className="cursor-pointer">{t("detail")}</summary><dl className="mt-2 space-y-1 text-xs"><Fact label={t("executionState")} value={item.executionState ?? item.lifecycleState ?? ""} /><Fact label={t("anomaly")} value={item.impactReason} /><Fact label={t("detail")} value={item.blockerReason ?? ""} /><Fact label={t("updatedAt")} value={formatDate(item.lastActivityAt)} /></dl></details>
        </article>)}</Rows> : <Empty />}
      </TrackingSection>
      <div className="grid gap-6 xl:grid-cols-2">
        <TrackingSection title={t("executions")}>
          {data.executionAnomalies.length ? <Rows>{data.executionAnomalies.map((item) => <article key={`${item.assessmentId}-${item.executionId ?? item.detectedAt}`} className="rounded-lg border p-3">
            <p className="font-medium">{item.assessmentId}</p>
            <p className="mt-1 text-xs text-muted-foreground">{item.anomalyType}</p>
            <details className="mt-2 text-sm"><summary className="cursor-pointer">{t("detail")}</summary><dl className="mt-2 space-y-1 text-xs"><Fact label={t("executionState")} value={item.executionState} /><Fact label={t("duration")} value={item.durationSeconds === null ? "" : `${item.durationSeconds} ${t("secondsUnit")}`} /><Fact label={t("runtimeVersion")} value={item.rootAgentVersion ?? ""} /><Fact label={t("generatedAt")} value={formatDate(item.detectedAt)} /></dl></details>
          </article>)}</Rows> : <Empty />}
        </TrackingSection>
        <TrackingSection title={t("usage")}>
          {data.unreconciledUsage.length ? <Rows>{data.unreconciledUsage.map((item) => <article key={item.eventId} className="rounded-lg border p-3">
            <p className="font-medium">{item.assessmentId ?? item.eventId}</p><p className="mt-1 text-xs text-muted-foreground">{t("model")}: {item.model}</p>
            <details className="mt-2 text-sm"><summary className="cursor-pointer">{t("detail")}</summary><dl className="mt-2 space-y-1 text-xs"><Fact label={t("tokenCount")} value={item.totalTokens?.toLocaleString(appLocale) ?? ""} /><Fact label={t("generatedAt")} value={formatDate(item.createdAt)} /></dl></details>
          </article>)}</Rows> : <Empty />}
        </TrackingSection>
      </div>
      <TrackingSection title={t("untrusted")}>
        {data.untrustedProjections.length ? <Rows>{data.untrustedProjections.map((item) => <article id={`investigation-${item.assessmentId}`} key={`${item.assessmentId}-${item.untrustedReason}`} className="rounded-lg border p-3"><p className="font-medium">{item.name}</p><p className="mt-1 text-sm">{untrustedReasonMessage(item.untrustedReason)}</p><p className="mt-1 text-xs text-muted-foreground">{formatDate(item.detectedAt)}</p><details className="mt-2 text-sm"><summary className="cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("detail")}</summary><dl className="mt-2 space-y-1 text-xs"><Fact label={t("assessmentIdLabel")} value={item.assessmentId} /><Fact label={t("detectedAt")} value={formatDate(item.detectedAt)} /></dl></details><Link href={`/admin/tracking#investigation-${encodeURIComponent(item.assessmentId)}`} className="mt-3 inline-flex min-h-10 items-center rounded-md text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("investigateAssessment")}</Link></article>)}</Rows> : <Empty />}
      </TrackingSection>
    </> : null}
  </div>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle></CardHeader><CardContent><p className="text-3xl font-semibold tabular-nums">{value.toLocaleString(appLocale)}</p></CardContent></Card>;
}

function Rows({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3">{children}</div>;
}

function Empty() {
  return <p className="text-sm text-muted-foreground">{t("noOperationalItems")}</p>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{label}</dt><dd className="max-w-3/5 break-all text-right">{value || t("notAvailable")}</dd></div>;
}

function t(suffix: string) {
  return resolveMessage(appLocale, `pages.workspace.tracking.${suffix}` as MessageKey);
}

function untrustedReasonMessage(reason: TrackingUntrustedReason) {
  return t(`untrustedReason.${reason}`);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(appLocale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
