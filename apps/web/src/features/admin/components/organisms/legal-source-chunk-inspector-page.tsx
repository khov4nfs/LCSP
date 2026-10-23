"use client";

import { useState } from "react";
import Link from "next/link";
import type { MessageKey } from "@lcsp/i18n";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useLegalSourceChunkPageQuery } from "@/lib/api/legal-source-queries";
import { formatAppMessage, resolveAppMessage } from "@/lib/i18n";
import {
  LEGAL_SOURCE_CHUNK_PAGE_SIZES,
  LEGAL_SOURCE_EFFECT_STATUS_MESSAGE_KEYS,
} from "../../config/legal-source-display.config";

const t = (key: string) => resolveAppMessage(key as MessageKey);

export function LegalSourceChunkInspectorPage({
  versionId,
  documentRowId,
}: {
  versionId: string;
  documentRowId: string;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const query = useLegalSourceChunkPageQuery({
    versionId,
    documentRowId,
    page,
    pageSize,
  });

  if (query.isPending) return <Skeleton className="h-72 w-full" />;
  if (query.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex items-center justify-between gap-3">
          <span>{t("pages.legalSources.loadFailed")}</span>
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t("pages.legalSources.tryAgain")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const chunks = query.data;
  const totalPages = Math.max(1, Math.ceil(chunks.total / chunks.pageSize));
  return (
    <div className="flex flex-col gap-6 pb-12">
      <Link
        href={`/admin/legal-source-versions/${encodeURIComponent(versionId)}`}
        className="w-fit text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {t("pages.legalSources.backToVersion")}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">
            {t("pages.legalSources.chunkInspectorTitle")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatAppMessage(
              "pages.legalSources.chunkCountForPage" as MessageKey,
              {
                count: chunks.items.length,
              },
            )}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="chunk-page-size">
            {t("pages.legalSources.pageSizeLabel")}
          </Label>
          <select
            id="chunk-page-size"
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.currentTarget.value));
              setPage(1);
            }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {LEGAL_SOURCE_CHUNK_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
      </div>
      {chunks.items.length > 0 ? (
        <div className="flex flex-col gap-4">
          {chunks.items.map((chunk) => (
            <Card key={chunk.id}>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">
                      {t("pages.legalSources.locatorLabel")}
                    </p>
                    <code className="font-mono">{chunk.locator}</code>
                  </div>
                  <div>
                    <p className="text-muted-foreground">
                      {t("pages.legalSources.legalEffectStatusLabel")}
                    </p>
                    <span>
                      {t(
                        LEGAL_SOURCE_EFFECT_STATUS_MESSAGE_KEYS[
                          chunk.legalEffectStatus
                        ] as MessageKey,
                      )}
                    </span>
                  </div>
                  <div>
                    <p className="text-muted-foreground">
                      {t("pages.legalSources.legalStatusSourceRefLabel")}
                    </p>
                    <span>{chunk.legalStatusSourceRef ?? "—"}</span>
                  </div>
                  <div>
                    <p className="text-muted-foreground">
                      {t("pages.legalSources.pageRangeLabel")}
                    </p>
                    <span>
                      {formatPageRange(chunk.pageStart, chunk.pageEnd)}
                    </span>
                  </div>
                  <div>
                    <p className="text-muted-foreground">
                      {t("pages.legalSources.chunkHashLabel")}
                    </p>
                    <code className="break-all font-mono text-xs">
                      {chunk.contentSha256}
                    </code>
                  </div>
                </div>
                {Object.values(chunk.hierarchy).some(isDisplayValue) ? (
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t("pages.legalSources.hierarchyLabel")}
                    </p>
                    <p className="text-sm">
                      {Object.values(chunk.hierarchy)
                        .filter(isDisplayValue)
                        .join(" › ")}
                    </p>
                  </div>
                ) : null}
                <div>
                  <p className="text-sm text-muted-foreground">
                    {t("pages.legalSources.contentLabel")}
                  </p>
                  <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/50 p-4 font-sans text-sm leading-6">
                    {chunk.content}
                  </pre>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          {t("pages.legalSources.emptyChunks")}
        </p>
      )}
      <nav
        aria-label={t("pages.legalSources.chunkInspectorTitle")}
        className="flex items-center justify-between gap-3"
      >
        <Button
          type="button"
          variant="outline"
          disabled={page <= 1}
          onClick={() => setPage((current) => Math.max(1, current - 1))}
        >
          {t("pages.legalSources.previousPage")}
        </Button>
        <span className="text-sm text-muted-foreground">
          {formatAppMessage("pages.legalSources.pageLabel" as MessageKey, {
            page: chunks.page,
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
          {t("pages.legalSources.nextPage")}
        </Button>
      </nav>
    </div>
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
