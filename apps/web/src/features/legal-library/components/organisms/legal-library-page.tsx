"use client";

import { useMemo, useState } from "react";
import { SearchIcon } from "lucide-react";
import {
  LEGAL_SOURCE_ERROR_CODES,
  type ActiveLegalLibrary,
} from "@lcsp/contracts/legal-source";
import type { MessageKey } from "@lcsp/i18n";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiRequestError } from "@/lib/api/api-request";
import { useActiveLegalLibraryQuery } from "@/lib/api/legal-source-queries";
import { formatAppMessage, resolveAppMessage } from "@/lib/i18n";
import { appLocale } from "@/lib/locale";

import { LegalDocumentCard } from "../molecules/legal-document-card";

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
  const [search, setSearch] = useState("");
  const filteredDocuments = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return library.documents;
    return library.documents.filter(
      (doc) =>
        doc.title.toLowerCase().includes(query) ||
        doc.sourceEffectStatus.toLowerCase().includes(query),
    );
  }, [library.documents, search]);

  if (library.documents.length === 0) return <LegalLibraryEmptyState />;
  return (
    <div className="flex flex-col gap-6 pb-12">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium text-brand-deep">
          {formatAppMessage(
            "pages.legalLibrary.activeVersionLabel" as MessageKey,
            {
              version: library.version,
            },
          )}
        </p>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          {t("pages.legalLibrary.pageTitle")}
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t("pages.legalLibrary.pageDescription")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("pages.legalLibrary.sourceNameLabel")}: {library.sourceName}
        </p>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-64 flex-1 sm:max-w-sm">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label={t("pages.legalLibrary.searchPlaceholder")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("pages.legalLibrary.searchPlaceholder")}
            className="h-9 pl-9"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {formatAppMessage("pages.legalLibrary.showingCount" as MessageKey, {
            shown: filteredDocuments.length.toLocaleString(appLocale),
            total: library.documents.length.toLocaleString(appLocale),
          })}
        </p>
      </div>

      {filteredDocuments.length === 0 ? (
        <section className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t("pages.legalLibrary.noMatchingDocuments")}
        </section>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filteredDocuments.map((document) => (
            <LegalDocumentCard key={document.id} document={document} />
          ))}
        </div>
      )}
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
