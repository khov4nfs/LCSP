"use client";

import Link from "next/link";
import type { MessageKey } from "@lcsp/i18n";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useLegalSourceQuery } from "@/lib/api/legal-source-queries";
import { resolveAppMessage } from "@/lib/i18n";
import { AdminPageHeader } from "../molecules/admin-page-header";
import { LegalSourceEditForm } from "../molecules/legal-source-edit-form";
import { LegalSourceStartVersionDialog } from "../molecules/legal-source-start-version-dialog";
import { LegalSourceVersionsTable } from "./legal-source-versions-table";

const t = (key: string) => resolveAppMessage(key as MessageKey);

export function LegalSourceDetailPage({ sourceId }: { sourceId: string }) {
  const sourceQuery = useLegalSourceQuery(sourceId);
  if (sourceQuery.isPending) return <Skeleton className="h-72 w-full" />;
  if (sourceQuery.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex items-center justify-between gap-3">
          <span>{t("pages.legalSources.loadFailed")}</span>
          <Button variant="outline" onClick={() => void sourceQuery.refetch()}>
            {t("pages.legalSources.tryAgain")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const source = sourceQuery.data;
  const openDraft = source.openDraftVersionId
    ? source.versions.find(
        (version) => version.id === source.openDraftVersionId,
      )
    : undefined;

  return (
    <div className="flex flex-col gap-6 pb-12">
      <Link
        href="/admin/legal-sources"
        className="w-fit text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {t("pages.legalSources.listTitle")}
      </Link>
      <AdminPageHeader
        title={source.name}
        description={source.description ?? source.slug}
      />
      <Card>
        <CardHeader>
          <CardTitle>{t("pages.legalSources.sourceLabel")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="font-mono text-sm text-muted-foreground">
            {source.slug}
          </p>
          <LegalSourceEditForm source={source} />
        </CardContent>
      </Card>
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">
            {t("pages.legalSources.versionsTitle")}
          </h2>
          {source.canCreateVersion ? (
            <LegalSourceStartVersionDialog source={source} />
          ) : openDraft ? (
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <Link
                  href={`/admin/legal-source-versions/${encodeURIComponent(openDraft.id)}`}
                />
              }
            >
              {t("pages.legalSources.openDraftVersion")}
            </Button>
          ) : null}
        </div>
        <LegalSourceVersionsTable versions={source.versions} />
      </section>
    </div>
  );
}
