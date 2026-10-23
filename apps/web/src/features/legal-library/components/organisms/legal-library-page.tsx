"use client";

import Link from "next/link";
import {
  LEGAL_SOURCE_ERROR_CODES,
  type ActiveLegalLibrary,
} from "@lcsp/contracts/legal-source";
import type { MessageKey } from "@lcsp/i18n";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiRequestError } from "@/lib/api/api-request";
import { useActiveLegalLibraryQuery } from "@/lib/api/legal-source-queries";
import { formatAppMessage, resolveAppMessage } from "@/lib/i18n";

const t = (key: string) => resolveAppMessage(key as MessageKey);

export function LegalLibraryPage() {
  const library = useActiveLegalLibraryQuery();
  if (library.isPending) return <Skeleton className="h-72 w-full" />;
  if (library.isError) {
    if (
      library.error instanceof ApiRequestError &&
      library.error.problemCode ===
        LEGAL_SOURCE_ERROR_CODES.activeLegalSourceNotFound
    ) {
      return <LegalLibraryEmptyState />;
    }
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex items-center justify-between gap-3">
          <span>{t("pages.legalLibrary.loadFailed")}</span>
          <Button variant="outline" onClick={() => void library.refetch()}>
            {t("pages.legalLibrary.tryAgain")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return <LegalLibraryContent library={library.data} />;
}

function LegalLibraryContent({ library }: { library: ActiveLegalLibrary }) {
  if (library.documents.length === 0) return <LegalLibraryEmptyState />;
  return (
    <div className="flex flex-col gap-6 pb-12">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium text-primary">
          {formatAppMessage(
            "pages.legalLibrary.activeVersionLabel" as MessageKey,
            {
              version: library.version,
            },
          )}
        </p>
        <h1 className="text-3xl font-semibold">
          {t("pages.legalLibrary.pageTitle")}
        </h1>
        <p className="max-w-3xl text-muted-foreground">
          {t("pages.legalLibrary.pageDescription")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("pages.legalLibrary.sourceNameLabel")}: {library.sourceName}
        </p>
      </header>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {library.documents.map((document) => (
          <Card key={document.id} className="h-full">
            <CardHeader>
              <CardTitle>{document.title}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">
                    {t("pages.legalLibrary.sourceEffectStatusLabel")}
                  </dt>
                  <dd>{document.sourceEffectStatus}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {t("pages.legalLibrary.effectiveDateLabel")}
                  </dt>
                  <dd>{document.effectiveDate ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {t("pages.legalLibrary.chunkCountLabel")}
                  </dt>
                  <dd>{document.chunkCount}</dd>
                </div>
              </dl>
              <div className="mt-auto flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="default"
                  nativeButton={false}
                  render={
                    <Link href={`/laws/${encodeURIComponent(document.id)}`} />
                  }
                >
                  {t("pages.legalLibrary.readDocument")}
                </Button>
                {httpsUrl(document.sourceUrl) ? (
                  <Button
                    type="button"
                    variant="outline"
                    nativeButton={false}
                    render={
                      <a
                        href={httpsUrl(document.sourceUrl)}
                        target="_blank"
                        rel="noreferrer"
                      />
                    }
                  >
                    {t("pages.legalLibrary.openOfficialSource")}
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function LegalLibraryEmptyState() {
  return (
    <section className="rounded-xl border border-dashed p-8 text-center">
      <h1 className="text-xl font-semibold">
        {t("pages.legalLibrary.emptyTitle")}
      </h1>
      <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
        {t("pages.legalLibrary.emptyDescription")}
      </p>
    </section>
  );
}

function httpsUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}
