"use client";

import { useDeferredValue, useState } from "react";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { appLocale } from "@/lib/locale";
import { useCustomerTrackingOverviewQuery } from "@/lib/api/tracking-queries";
import { AssessmentTrackingCard, TrackingError } from "./tracking-dashboard";

export function TrackingAssessmentsPage() {
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const deferredSearch = useDeferredValue(search.trim());
  const query = useCustomerTrackingOverviewQuery(deferredSearch, offset);
  const data = query.data;

  return <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 lg:px-6">
    <header className="space-y-1"><h1 className="font-heading text-2xl font-semibold">{t("assessmentsTitle")}</h1><p className="text-sm text-muted-foreground">{t("assessmentsDescription")}</p></header>
    <label className="relative block max-w-md">
      <SearchIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} aria-label={t("searchLabel")} placeholder={t("searchPlaceholder")} className="pl-9" />
    </label>
    {query.isError ? <TrackingError onRetry={() => void query.refetch()} /> : null}
    {query.isPending ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"><Skeleton className="h-56" /><Skeleton className="h-56" /><Skeleton className="h-56" /></div> : null}
    {data && data.assessments.length ? <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{data.assessments.map((item) => <AssessmentTrackingCard key={item.assessmentId} item={item} />)}</div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{data.pagination.total.toLocaleString(appLocale)}</p>
        <div className="flex gap-2">
          <Button variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - data.pagination.limit))}>{t("previousPage")}</Button>
          <Button variant="outline" disabled={!data.pagination.hasMore} onClick={() => setOffset(offset + data.pagination.limit)}>{t("nextPage")}</Button>
        </div>
      </div>
    </> : data ? <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">{t("noAssessments")}</p> : null}
  </main>;
}

function t(suffix: string) {
  return resolveMessage(appLocale, `pages.workspace.tracking.${suffix}` as MessageKey);
}
