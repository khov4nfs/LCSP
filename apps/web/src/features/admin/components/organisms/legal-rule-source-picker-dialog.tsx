"use client";

import { useMemo, useState } from "react";
import { FileTextIcon, CheckIcon, Loader2Icon } from "lucide-react";
import type { z } from "zod";
import {
  legalRuleSavedSchema,
  legalRuleCitationSchema,
  legalRuleCatalogSchema,
} from "@lcsp/contracts/legal-rule-catalog";
import {
  legalSourceChunkViewSchema,
  type LegalSourceDocumentView,
} from "@lcsp/contracts/legal-source";

type LegalRuleCitation = z.infer<typeof legalRuleCitationSchema>;
type LegalSourceChunkView = z.infer<typeof legalSourceChunkViewSchema>;
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  useLegalSourceVersionQuery,
  useLegalSourceChunkPageQuery,
  useLegalSourceListQuery,
} from "@/lib/api/legal-source-queries";
import {
  legalRuleCatalogKey,
  useLegalRuleCatalogs,
} from "@/lib/api/legal-rule-catalog-queries";
import { useQueryClient } from "@tanstack/react-query";
import { ApiRequestError, apiValidated } from "@/lib/api/api-request";
import { catalogMessage as t } from "../../utils/legal-rule-catalog-message";

interface SelectedProvisionItem {
  chunkId: string;
  locator: string;
  content: string;
  documentId: string;
  documentTitle: string;
}

export interface LegalRuleSourcePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalogId: string;
  catalogRevision: number;
  initialLegalSourceVersionId?: string;
  onImported?: () => void;
}

/**
 * Business purpose: Allow administrators to visually pick a legal source, browse its document files, and select provisions across multiple files to populate a catalog without manual ID entry.
 * Business rules:
 * - Administrators pick a legal source from available versions without typing any identifiers.
 * - Selections are preserved across multiple document files within the active source version.
 * - Each selected provision is converted into a canonical LegalRule citing its exact document and locator.
 * - Rules are saved against advancing catalog revisions to ensure optimistic concurrency consistency.
 * Execution flow:
 * 1. Discover available legal source versions and resolve the target catalog.
 * 2. Query document files belonging to the selected legal source version.
 * 3. On document click, query its indexed provisions with pagination.
 * 4. Allow granular single-rule, page-wide, and cross-file multi-selection.
 * 5. On confirmation, sequentially persist all chosen rules into the target catalog.
 * Failure cases:
 * - Source query failure renders an error state; save failure interrupts subsequent writes and surfaces an alert.
 * Side effects:
 * - Emits multiple rule creation API requests and advances catalog revisions; closes dialog on completion.
 */
export function LegalRuleSourcePickerDialog({
  open,
  onOpenChange,
  catalogId,
  catalogRevision,
  initialLegalSourceVersionId,
  onImported,
}: LegalRuleSourcePickerDialogProps) {
  const queryClient = useQueryClient();
  const sourcesQuery = useLegalSourceListQuery();
  const catalogsQuery = useLegalRuleCatalogs();

  const availableSources = useMemo(() => {
    return (sourcesQuery.data?.items ?? []).flatMap((src) => {
      const v = src.activeVersion ?? src.latestVersion;
      if (!v) return [];
      return [
        {
          versionId: v.id,
          displayName: `${src.name} · ${v.version}`,
          versionName: v.version,
        },
      ];
    });
  }, [sourcesQuery.data]);

  const [selectedSourceVersionId, setSelectedSourceVersionId] =
    useState<string>("");

  const effectiveVersionId =
    selectedSourceVersionId ||
    initialLegalSourceVersionId ||
    availableSources[0]?.versionId ||
    "";

  const targetCatalog = useMemo(() => {
    if (!catalogsQuery.data || !effectiveVersionId) return null;
    return (
      catalogsQuery.data.find(
        (c) =>
          c.id === catalogId &&
          c.legalSourceVersionId === effectiveVersionId,
      ) ??
      catalogsQuery.data.find(
        (c) => c.legalSourceVersionId === effectiveVersionId,
      ) ??
      null
    );
  }, [catalogsQuery.data, effectiveVersionId, catalogId]);

  const activeCatalogId = targetCatalog?.id ?? "";
  const activeCatalogRevision = targetCatalog?.revision ?? catalogRevision;

  const versionQuery = useLegalSourceVersionQuery(effectiveVersionId);
  const documents = useMemo(
    () => versionQuery.data?.documents ?? [],
    [versionQuery.data?.documents],
  );

  const [activeDocId, setActiveDocId] = useState<string>("");
  const [chunkPage, setChunkPage] = useState(1);
  const [selectedProvisions, setSelectedProvisions] = useState<
    Map<string, SelectedProvisionItem>
  >(new Map());
  const [savingProgress, setSavingProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const activeDoc = useMemo(() => {
    if (!documents.length) return null;
    return documents.find((doc) => doc.id === activeDocId) ?? documents[0];
  }, [documents, activeDocId]);

  const effectiveDocId = activeDoc?.id ?? "";

  const chunksQuery = useLegalSourceChunkPageQuery({
    versionId: effectiveVersionId,
    documentRowId: effectiveDocId,
    page: chunkPage,
    pageSize: 50,
  });

  const chunks = chunksQuery.data?.items ?? [];
  const totalChunkCount = chunksQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalChunkCount / 50));

  const countsByDocId = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of selectedProvisions.values()) {
      map.set(item.documentId, (map.get(item.documentId) ?? 0) + 1);
    }
    return map;
  }, [selectedProvisions]);

  const uniqueFilesCount = useMemo(() => {
    return new Set(
      Array.from(selectedProvisions.values()).map((p) => p.documentId),
    ).size;
  }, [selectedProvisions]);

  function toggleChunk(
    chunk: LegalSourceChunkView,
    document: LegalSourceDocumentView,
  ) {
    const isEligible =
      chunk.legalEffectStatus === "EFFECTIVE" ||
      chunk.legalEffectStatus === "UNKNOWN";
    if (!isEligible) return;

    const next = new Map(selectedProvisions);
    if (next.has(chunk.id)) {
      next.delete(chunk.id);
    } else {
      next.set(chunk.id, {
        chunkId: chunk.id,
        locator: chunk.locator,
        content: chunk.content,
        documentId: document.documentId,
        documentTitle: document.title,
      });
    }
    setSelectedProvisions(next);
  }

  function selectAllInCurrentPage() {
    if (!activeDoc) return;
    const next = new Map(selectedProvisions);
    for (const chunk of chunks) {
      if (
        chunk.legalEffectStatus === "EFFECTIVE" ||
        chunk.legalEffectStatus === "UNKNOWN"
      ) {
        next.set(chunk.id, {
          chunkId: chunk.id,
          locator: chunk.locator,
          content: chunk.content,
          documentId: activeDoc.documentId,
          documentTitle: activeDoc.title,
        });
      }
    }
    setSelectedProvisions(next);
  }

  function deselectCurrentDoc() {
    if (!activeDoc) return;
    const next = new Map(selectedProvisions);
    for (const [key, val] of next.entries()) {
      if (val.documentId === activeDoc.documentId) {
        next.delete(key);
      }
    }
    setSelectedProvisions(next);
  }

  async function handleImport() {
    if (selectedProvisions.size === 0) return;
    const items = Array.from(selectedProvisions.values());
    setSavingProgress({ current: 0, total: items.length });
    setSaveError(null);

    let currentRev = activeCatalogRevision;
    let resolvedCatalogId = activeCatalogId;

    try {
      if (!resolvedCatalogId) {
        const src = availableSources.find(
          (s) => s.versionId === effectiveVersionId,
        );
        const newCatalog = await apiValidated(
          "/api/admin/legal-rule-catalog",
          legalRuleCatalogSchema,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              version: `${src?.versionName ?? "v1.0"}-catalog`,
              legalSourceVersionId: effectiveVersionId,
            }),
          },
        );
        resolvedCatalogId = newCatalog.id;
        currentRev = newCatalog.revision;
      }

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        setSavingProgress({ current: i + 1, total: items.length });

        const cleanDocId = item.documentId
          .trim()
          .replace(/[^a-zA-Z0-9_-]/g, "_");
        const cleanLocator = item.locator.trim().replace(/\s+/g, "-");
        const legalRuleId = `${cleanDocId}-${cleanLocator}`.slice(0, 128);

        const citationLocatorRefs: LegalRuleCitation[] = [
          { documentId: item.documentId, locator: item.locator },
        ];

        const title = `${item.documentTitle} - ${item.locator}`.slice(0, 512);
        const description =
          item.content.trim() || `${item.documentTitle} - ${item.locator}`;

        const result = await apiValidated(
          `/api/admin/legal-rule-catalog/${resolvedCatalogId}/rules`,
          legalRuleSavedSchema,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              legalRuleId,
              title,
              description,
              citationLocatorRefs,
              expectedRevision: currentRev,
            }),
          },
        );

        currentRev = result.catalogRevision;
      }

      await queryClient.invalidateQueries({ queryKey: legalRuleCatalogKey });
      setSelectedProvisions(new Map());
      setSavingProgress(null);
      onImported?.();
      onOpenChange(false);
    } catch (err: unknown) {
      const msg =
        err instanceof ApiRequestError && err.problemCode
          ? `${t("error")}: ${err.problemCode}`
          : err instanceof Error
            ? err.message
            : t("error");
      setSaveError(msg);
      setSavingProgress(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88vh] max-h-[90vh] max-w-[95vw] flex-col gap-0 overflow-hidden rounded-2xl border border-border/70 bg-card p-0 sm:max-w-5xl">
        {/* Header with clean vertical title & description, inheriting top rounded corners */}
        <div className="flex flex-col gap-1.5 rounded-t-2xl border-b border-border/70 bg-muted/30 px-6 py-5 pr-14">
          <DialogTitle className="text-lg font-semibold tracking-tight text-foreground">
            {t("sourcePickerTitle")}
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed text-muted-foreground">
            {t("sourcePickerDescription")}
          </DialogDescription>
        </div>

        {/* Content body takes remaining vertical space */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-5">
          {/* Source Selector Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-2.5">
            <div className="flex flex-1 items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                {t("sourceSelectLabel")}:
              </span>
              <Select
                value={effectiveVersionId}
                onValueChange={(val) => {
                  if (!val) return;
                  setSelectedSourceVersionId(val);
                  setActiveDocId("");
                  setChunkPage(1);
                }}
              >
                <SelectTrigger className="h-8 min-w-64 text-xs font-medium">
                  <SelectValue placeholder={t("chooseSource")}>
                    {availableSources.find((s) => s.versionId === effectiveVersionId)
                      ?.displayName ?? t("chooseSource")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {availableSources.map((s) => (
                    <SelectItem
                      key={s.versionId}
                      value={s.versionId}
                      className="text-xs"
                    >
                      {s.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {targetCatalog ? (
              <Badge variant="outline" className="text-xs">
                Catalog: {targetCatalog.version} · rev {targetCatalog.revision}
              </Badge>
            ) : null}
          </div>

          {versionQuery.isPending ? (
            <Skeleton className="h-96 w-full" />
          ) : versionQuery.isError ? (
            <div className="p-4 text-center text-sm text-destructive">
              {t("error")}
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden md:grid-cols-12">
              {/* Left side: Documents list */}
              <div className="flex min-h-0 flex-col gap-2 overflow-y-auto border-r pr-3 md:col-span-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("documentsInSource")} ({documents.length})
                </span>
                <div className="flex flex-col gap-1.5">
                  {documents.map((doc) => {
                    const isSelected = (activeDoc?.id ?? "") === doc.id;
                    const pickedCount = countsByDocId.get(doc.documentId) ?? 0;
                    return (
                      <button
                        key={doc.id}
                        type="button"
                        onClick={() => {
                          setActiveDocId(doc.id);
                          setChunkPage(1);
                        }}
                        className={`flex items-start justify-between gap-2 rounded-lg p-2.5 text-left transition-colors ${
                          isSelected
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted/40 hover:bg-muted"
                        }`}
                      >
                        <div className="flex min-w-0 flex-1 items-start gap-2">
                          <FileTextIcon className="mt-0.5 size-4 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 text-xs font-medium">
                              {doc.title}
                            </p>
                            <p
                              className={`mt-1 text-xs ${
                                isSelected
                                  ? "text-primary-foreground/80"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {doc.chunkCount} điều khoản
                            </p>
                          </div>
                        </div>
                        {pickedCount > 0 ? (
                          <Badge
                            variant={isSelected ? "secondary" : "default"}
                            className="shrink-0 text-xs"
                          >
                            {pickedCount}
                          </Badge>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Right side: Provisions list */}
              <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden md:col-span-8">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
                  <div className="min-w-0 flex-1">
                    <h4 className="truncate text-sm font-semibold">
                      {activeDoc?.title ?? t("selectFileToViewProvisions")}
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      {totalChunkCount} điều khoản · Trang {chunkPage}/{totalPages}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={selectAllInCurrentPage}
                      disabled={!chunks.length || savingProgress !== null}
                    >
                      {t("selectAllInPage")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs"
                      onClick={deselectCurrentDoc}
                      disabled={
                        !countsByDocId.get(activeDoc?.documentId ?? "") ||
                        savingProgress !== null
                      }
                    >
                      {t("deselectAll")}
                    </Button>
                  </div>
                </div>

                {/* Provisions items list */}
                <div className="min-h-0 flex-1 divide-y overflow-y-auto pr-1">
                {chunksQuery.isPending ? (
                  <div className="space-y-3 p-4">
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-14 w-full" />
                  </div>
                ) : chunks.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {t("noChunksInDocument")}
                  </p>
                ) : (
                  chunks.map((chunk) => {
                    const isChecked = selectedProvisions.has(chunk.id);
                    const isEligible =
                      chunk.legalEffectStatus === "EFFECTIVE" ||
                      chunk.legalEffectStatus === "UNKNOWN";
                    return (
                      <div
                        key={chunk.id}
                        onClick={() =>
                          isEligible && activeDoc && toggleChunk(chunk, activeDoc)
                        }
                        className={`flex items-start gap-3 p-3 transition-colors ${
                          !isEligible
                            ? "cursor-not-allowed bg-muted/10 opacity-50"
                            : isChecked
                              ? "cursor-pointer bg-muted/20 hover:bg-muted/30"
                              : "cursor-pointer hover:bg-muted/30"
                        }`}
                      >
                        <Checkbox
                          id={`chk-${chunk.id}`}
                          checked={isChecked}
                          disabled={!isEligible}
                          onCheckedChange={() =>
                            isEligible &&
                            activeDoc &&
                            toggleChunk(chunk, activeDoc)
                          }
                          className="mt-1"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-semibold text-primary">
                              {chunk.locator}
                            </span>
                            <Badge
                              variant={isEligible ? "outline" : "destructive"}
                              className="text-xs"
                            >
                              {chunk.legalEffectStatus}
                            </Badge>
                          </div>
                          <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                            {chunk.content}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Pagination */}
              {totalPages > 1 ? (
                <div className="flex items-center justify-between border-t pt-2 text-xs">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={chunkPage <= 1 || chunksQuery.isFetching}
                    onClick={() => setChunkPage((p) => Math.max(1, p - 1))}
                  >
                    {t("previous")}
                  </Button>
                  <span className="text-muted-foreground">
                    Trang {chunkPage} / {totalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={chunkPage >= totalPages || chunksQuery.isFetching}
                    onClick={() =>
                      setChunkPage((p) => Math.min(totalPages, p + 1))
                    }
                  >
                    {t("next")}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        )}

          {saveError ? (
            <p className="text-xs text-destructive">{saveError}</p>
          ) : null}
        </div>

        {/* Footer: Compact, single horizontal row with zero wasted empty space */}
        <div className="flex items-center justify-between gap-3 rounded-b-2xl border-t border-border/70 bg-card px-6 py-3.5">
          <div className="text-xs text-muted-foreground">
            {selectedProvisions.size > 0 ? (
              <span>
                Đã chọn:{" "}
                <strong className="font-semibold text-foreground">
                  {selectedProvisions.size}
                </strong>{" "}
                quy tắc từ{" "}
                <strong className="font-semibold text-foreground">
                  {uniqueFilesCount}
                </strong>{" "}
                file
              </span>
            ) : (
              <span>Chưa chọn quy tắc nào.</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={savingProgress !== null}
              onClick={() => onOpenChange(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={
                selectedProvisions.size === 0 || savingProgress !== null
              }
              onClick={() => void handleImport()}
            >
              {savingProgress ? (
                <>
                  <Loader2Icon className="mr-2 size-4 animate-spin" />
                  Đang thêm ({savingProgress.current}/{savingProgress.total})…
                </>
              ) : (
                <>
                  <CheckIcon className="mr-2 size-4" />
                  {t("addSelectedRulesToCatalog")} ({selectedProvisions.size})
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
