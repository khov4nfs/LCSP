"use client";

import type { MessageKey } from "@lcsp/i18n";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveAppMessage } from "@/lib/i18n";
import { useLegalSourceListQuery } from "@/lib/api/legal-source-queries";
import { AdminPageHeader } from "../molecules/admin-page-header";
import { LegalSourceCreateDialog } from "../molecules/legal-source-create-dialog";
import { LegalSourceListCard } from "../molecules/legal-source-list-card";

const t = (key: string) => resolveAppMessage(key as MessageKey);

export function LegalSourcesPage() {
  const sources = useLegalSourceListQuery();
  if (sources.isPending) return <Skeleton className="h-72 w-full" />;
  if (sources.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex items-center justify-between gap-3">
          <span>{t("pages.legalSources.loadFailed")}</span>
          <Button variant="outline" onClick={() => void sources.refetch()}>
            {t("pages.legalSources.tryAgain")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-12">
      <AdminPageHeader
        title={t("pages.legalSources.listTitle")}
        description={t("pages.legalSources.listDescription")}
      />
      <div className="flex justify-end">
        <LegalSourceCreateDialog />
      </div>
      {sources.data.items.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sources.data.items.map((source) => (
            <LegalSourceListCard key={source.id} source={source} />
          ))}
        </div>
      ) : (
        <section className="rounded-xl border border-dashed p-8 text-center">
          <h2 className="text-lg font-semibold">{t("pages.legalSources.emptyTitle")}</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
            {t("pages.legalSources.emptyDescription")}
          </p>
        </section>
      )}
    </div>
  );
}
