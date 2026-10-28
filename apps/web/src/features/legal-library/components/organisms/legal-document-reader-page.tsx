"use client";

import { useState } from "react";
import Link from "next/link";
import type { MessageKey } from "@lcsp/i18n";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiRequestError } from "@/lib/api/api-request";
import {
  useActiveLegalLibraryQuery,
  useLegalLibraryChunkPageQuery,
} from "@/lib/api/legal-source-queries";
import { LEGAL_SOURCE_ERROR_CODES } from "@lcsp/contracts/legal-source";
import { formatAppMessage, resolveAppMessage } from "@/lib/i18n";
import { LEGAL_LIBRARY_CHUNK_PAGE_SIZES } from "../../config/legal-library.config";

const t = (key: string) => resolveAppMessage(key as MessageKey);

export function LegalDocumentReaderPage({
  documentRowId,
}: {
  documentRowId: string;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const library = useActiveLegalLibraryQuery();
  const document = library.data?.documents.find(
    (item) => item.id === documentRowId,
  );
  const chunks = useLegalLibraryChunkPageQuery({
    documentRowId,
    page,
    pageSize,
    enabled: Boolean(document),
  });

  if (library.isPending) return <Skeleton className="h-72 w-full" />;
  if (library.isError) {
    if (
      library.error instanceof ApiRequestError &&
      library.error.problemCode ===
        LEGAL_SOURCE_ERROR_CODES.activeLegalSourceNotFound
    ) {
      return <LegalDocumentUnavailable />;
    }
    return <LegalLibraryLoadFailure onRetry={() => void library.refetch()} />;
  }
  if (!document) return <LegalDocumentUnavailable />;
  if (chunks.isPending) return <Skeleton className="h-72 w-full" />;
  if (chunks.isError) {
    return <LegalLibraryLoadFailure onRetry={() => void chunks.refetch()} />;
  }

  const totalPages = Math.max(
    1,
    Math.ceil(chunks.data.total / chunks.data.pageSize),
  );
  const originalPath = `/laws/${encodeURIComponent(document.id)}/file`;
  return (
    <div className="flex flex-col gap-6 pb-12">
      <Link
        href="/laws"
        className="w-fit text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {t("pages.legalLibrary.pageTitle")}
      </Link>
      <header className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {t("pages.legalLibrary.sourceNameLabel")}: {library.data.sourceName} ·{" "}
          {library.data.version}
        </p>
        <h1 className="text-3xl font-semibold">{document.title}</h1>
        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
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
        {document.hasOriginal ? (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              render={
                <a href={originalPath} target="_blank" rel="noreferrer" />
              }
            >
              {t("pages.legalLibrary.openOriginal")}
            </Button>
          </div>
        ) : null}
      </header>
      {document.hasOriginal ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">
            {t("pages.legalLibrary.originalViewerTitle")}
          </h2>
          <iframe
            src={originalPath}
            title={t("pages.legalLibrary.originalViewerTitle")}
            className="h-dvh min-h-96 w-full rounded-lg border bg-background"
          />
        </section>
      ) : null}
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="text-lg font-semibold">
            {t("pages.legalLibrary.readDocument")}
          </h2>
          <div className="flex flex-col gap-2">
            <Label htmlFor="library-page-size">
              {t("pages.legalLibrary.pageSizeLabel")}
            </Label>
            <select
              id="library-page-size"
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.currentTarget.value));
                setPage(1);
              }}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {LEGAL_LIBRARY_CHUNK_PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
        </div>
        {chunks.data.items.length > 0 ? (
          <div className="flex flex-col gap-4">
            {chunks.data.items.map((chunk) => (
              <Card key={chunk.id}>
                <CardContent className="flex flex-col gap-4">
                  <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                    <div>
                      <p className="text-muted-foreground">
                        {t("pages.legalLibrary.locatorLabel")}
                      </p>
                      <code className="font-mono">{chunk.locator}</code>
                    </div>
                    <div>
                      <p className="text-muted-foreground">
                        {t("pages.legalLibrary.pageRangeLabel")}
                      </p>
                      <span>
                        {formatPageRange(chunk.pageStart, chunk.pageEnd)}
                      </span>
                    </div>
                    <div>
                      <p className="text-muted-foreground">
                        {t("pages.legalLibrary.contentHashLabel")}
                      </p>
                      <code className="break-all font-mono text-xs">
                        {chunk.contentSha256}
                      </code>
                    </div>
                  </div>
                  {Object.values(chunk.hierarchy).some(isDisplayValue) ? (
                    <div>
                      <p className="text-sm text-muted-foreground">
                        {t("pages.legalLibrary.hierarchyLabel")}
                      </p>
                      <p className="text-sm">
                        {Object.values(chunk.hierarchy)
                          .filter(isDisplayValue)
                          .join(" › ")}
                      </p>
                    </div>
                  ) : null}
                  <pre className="whitespace-pre-wrap rounded-lg bg-muted/50 p-4 font-sans text-sm leading-6">
                    {chunk.content}
                  </pre>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            {t("pages.legalLibrary.emptyChunks")}
          </p>
        )}
        <nav
          aria-label={t("pages.legalLibrary.readDocument")}
          className="flex items-center justify-between gap-3"
        >
          <Button
            type="button"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            {t("pages.legalLibrary.previousPage")}
          </Button>
          <span className="text-sm text-muted-foreground">
            {formatAppMessage("pages.legalLibrary.pageLabel" as MessageKey, {
              page: chunks.data.page,
              totalPages,
            })}
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={page >= totalPages}
            onClick={() =>
              setPage((current) => Math.min(totalPages, current + 1))
            }
          >
            {t("pages.legalLibrary.nextPage")}
          </Button>
        </nav>
      </section>
    </div>
  );
}

function LegalLibraryLoadFailure({ onRetry }: { onRetry: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertDescription className="flex items-center justify-between gap-3">
        <span>{t("pages.legalLibrary.loadFailed")}</span>
        <Button variant="outline" onClick={onRetry}>
          {t("pages.legalLibrary.tryAgain")}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function LegalDocumentUnavailable() {
  return (
    <section className="rounded-xl border border-dashed p-8 text-center">
      <h1 className="text-xl font-semibold">
        {t("pages.legalLibrary.documentUnavailableTitle")}
      </h1>
      <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
        {t("pages.legalLibrary.documentUnavailableDescription")}
      </p>
      <Link
        href="/laws"
        className="mt-4 inline-flex text-sm text-primary underline-offset-4 hover:underline"
      >
        {t("pages.legalLibrary.pageTitle")}
      </Link>
    </section>
  );
}

function isDisplayValue(value: unknown): value is string | number {
  return typeof value === "string" || typeof value === "number";
}

function formatPageRange(start: number | null, end: number | null) {
  if (start === null && end === null) return "—";
  if (start === end || end === null) return String(start ?? end);
  if (start === null) return String(end);
  return `${start}–${end}`;
}
