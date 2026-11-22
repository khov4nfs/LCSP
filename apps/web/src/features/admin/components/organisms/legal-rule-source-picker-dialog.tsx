"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileTextIcon, CheckIcon, Loader2Icon } from "lucide-react";
import {
  LEGAL_RULE_LIMITS,
  LEGAL_RULE_SOURCE_PROVISION_LIMITATIONS,
  LEGAL_RULE_SOURCE_PROVISION_LEVELS,
  legalRuleCatalogSchema,
  type LegalRuleSourceProvision,
} from "@lcsp/contracts/legal-rule-catalog";
import type { LegalSourceDocumentView } from "@lcsp/contracts/legal-source";
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
  useLegalSourceListQuery,
} from "@/lib/api/legal-source-queries";
import {
  legalRuleCatalogKey,
  useLegalRuleCatalogs,
  useLegalRuleSourceProvisions,
  useImportLegalRuleSourceProvision,
} from "@/lib/api/legal-rule-catalog-queries";
import { ApiRequestError, apiValidated } from "@/lib/api/api-request";
import { catalogMessage as t } from "../../utils/legal-rule-catalog-message";
import { LegalRuleReferencePreview } from "../molecules/legal-rule-reference-preview";
import {
  formatLegalProvisions,
  formatLocator,
} from "../../utils/legal-rule-formatter";

interface SelectedProvisionItem {
  sourceVersionId: string;
  legalRuleId: string;
  locator: string;
  documentId: string;
  documentTitle: string;
  description: string;
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
 * - Only server-projected EFFECTIVE Article–Clause–Point leaves are selectable; parent metadata is composed independently of pagination.
 * - Selections are keyed by source-version-scoped leaf identity and remain available across pages and documents.
 * - The import endpoint recomputes rule identity, description and exact citations from the catalog's pinned source.
 * Execution flow:
 * 1. Discover available legal source versions and resolve the target catalog.
 * 2. Query document files belonging to the selected legal source version.
 * 3. On document click, query server-composed eligible leaf provisions with pagination.
 * 4. Allow granular single-rule, page-wide, and cross-file multi-selection.
 * 5. On confirmation, resolve one pinned catalog per selected source version and sequentially import each selected leaf.
 * Failure cases:
 * - Source query failure renders an error state; provisions without EFFECTIVE source status remain unselectable and are explained; save failure interrupts subsequent writes and surfaces an alert.
 * Side effects:
 * - Emits multiple rule creation API requests and advances catalog revisions; closes dialog on completion.
 */
export function LegalRuleSourcePickerDialog({
  open,
  onOpenChange,
  catalogId,
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

  const versionQuery = useLegalSourceVersionQuery(effectiveVersionId);
  const documents = useMemo(
    () => versionQuery.data?.documents ?? [],
    [versionQuery.data?.documents],
  );

  const [activeDocId, setActiveDocId] = useState<string>("");
  const [provisionPage, setProvisionPage] = useState(1);
  const [selectedProvisions, setSelectedProvisions] = useState<
    Map<string, SelectedProvisionItem>
  >(new Map());
  const [savingProgress, setSavingProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const importProvisionMutation = useImportLegalRuleSourceProvision();

  const activeDoc = useMemo(() => {
    if (!documents.length) return null;
    return documents.find((doc) => doc.id === activeDocId) ?? documents[0];
  }, [documents, activeDocId]);

  const provisionsQuery = useLegalRuleSourceProvisions(
    effectiveVersionId,
    activeDoc?.documentId ?? "",
    provisionPage,
  );
  const provisions = provisionsQuery.data?.items ?? [];
  const totalProvisionCount = provisionsQuery.data?.total ?? 0;
  const hasNonEffectiveStatus =
    provisionsQuery.data?.limitations.some(
      (limitation) =>
        limitation.reason ===
        LEGAL_RULE_SOURCE_PROVISION_LIMITATIONS.EFFECT_NOT_EFFECTIVE,
    ) ?? false;
  const hasOtherLimitations =
    provisionsQuery.data?.limitations.some(
      (limitation) =>
        limitation.reason !==
        LEGAL_RULE_SOURCE_PROVISION_LIMITATIONS.EFFECT_NOT_EFFECTIVE,
    ) ?? false;
  const totalPages = Math.max(
    1,
    Math.ceil(totalProvisionCount / LEGAL_RULE_LIMITS.pageSize),
  );

  const countsByDocId = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of selectedProvisions.values()) {
      const key = `${item.sourceVersionId}::${item.documentId}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [selectedProvisions]);

  const uniqueFilesCount = useMemo(() => {
    return new Set(
      Array.from(selectedProvisions.values()).map(
        (p) => `${p.sourceVersionId}::${p.documentId}`,
      ),
    ).size;
  }, [selectedProvisions]);

  /**
   * Business purpose: Toggle one server-approved legal leaf without losing selections made elsewhere.
   * Business rules: The stable source-version-scoped LegalRule identity prevents duplicate imports through repeated UI paths.
   * Execution flow: Copy the current selection map, remove the existing identity or add its composed preview, then publish the map.
   * Failure cases: Missing provision identity cannot be selected because it is supplied by the validated projection contract.
   * Side effects: Updates dialog-local selection state only.
   */
  function toggleProvision(
    provision: LegalRuleSourceProvision,
    document: LegalSourceDocumentView,
  ) {
    const next = new Map(selectedProvisions);
    if (next.has(provision.legalRuleId)) {
      next.delete(provision.legalRuleId);
    } else {
      next.set(provision.legalRuleId, {
        sourceVersionId: provision.sourceVersionId,
        legalRuleId: provision.legalRuleId,
        locator: provision.locator,
        documentId: document.documentId,
        documentTitle: document.title,
        description: provision.description,
      });
    }
    setSelectedProvisions(next);
  }

  /**
   * Business purpose: Select every eligible leaf shown on the current server page.
   * Business rules: The server projection excludes unclassified and ineligible chunks; parent selections expand only when the server marks a substantive parent as a leaf.
   * Execution flow: Add each visible leaf by its stable identity while retaining other page/document selections.
   * Failure cases: An absent document or empty page is a no-op.
   * Side effects: Updates dialog-local selection state only.
   */
  function selectAllInCurrentPage() {
    if (!activeDoc) return;
    const next = new Map(selectedProvisions);
    for (const provision of provisions) {
      next.set(provision.legalRuleId, {
        sourceVersionId: provision.sourceVersionId,
        legalRuleId: provision.legalRuleId,
        locator: provision.locator,
        documentId: activeDoc.documentId,
        documentTitle: activeDoc.title,
        description: provision.description,
      });
    }
    setSelectedProvisions(next);
  }

  /**
   * Business purpose: Clear selected provisions only from the currently displayed source document.
   * Business rules: Source version is part of document scope so switching versions cannot clear another version's choices.
   * Execution flow: Remove selection entries matching the active source version and document identity.
   * Failure cases: Missing document is a no-op.
   * Side effects: Updates dialog-local selection state only.
   */
  function deselectCurrentDoc() {
    if (!activeDoc) return;
    const next = new Map(selectedProvisions);
    for (const [key, val] of next.entries()) {
      if (
        val.sourceVersionId === effectiveVersionId &&
        val.documentId === activeDoc.documentId
      ) {
        next.delete(key);
      }
    }
    setSelectedProvisions(next);
  }

  /**
   * Business purpose: Import each selected eligible leaf into the catalog pinned to its exact source version.
   * Business rules: Every import sends only document/leaf identity and the current catalog revision; the backend recomposes legal text and citations.
   * Execution flow: Group selections by source version, find or create each matching catalog, then import each leaf sequentially while advancing the revision.
   * Failure cases: Any source, catalog, revision or citation rejection stops later writes and leaves selections available for review.
   * Side effects: Creates a missing editable catalog, saves selected LegalRules, advances catalog revisions, and closes the dialog after all writes succeed.
   */
  async function handleImport() {
    if (selectedProvisions.size === 0) return;
    const items = Array.from(selectedProvisions.values());
    setSavingProgress({ current: 0, total: items.length });
    setSaveError(null);

    try {
      let completed = 0;
      const bySource = new Map<string, SelectedProvisionItem[]>();
      for (const item of items) {
        bySource.set(item.sourceVersionId, [
          ...(bySource.get(item.sourceVersionId) ?? []),
          item,
        ]);
      }
      for (const [sourceVersionId, provisionsForSource] of bySource) {
        let catalog = catalogsQuery.data?.find(
          (candidate) =>
            candidate.id === catalogId &&
            candidate.legalSourceVersionId === sourceVersionId,
        ) ?? catalogsQuery.data?.find(
          (candidate) => candidate.legalSourceVersionId === sourceVersionId,
        );
        if (!catalog) {
          const src = availableSources.find(
            (source) => source.versionId === sourceVersionId,
          );
          catalog = await apiValidated(
            "/api/admin/legal-rule-catalog",
            legalRuleCatalogSchema,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                version: `${src?.versionName ?? "source"}-catalog`,
                legalSourceVersionId: sourceVersionId,
              }),
            },
          );
        }
        let currentRev = catalog.revision;
        for (const item of provisionsForSource) {
          completed += 1;
          setSavingProgress({ current: completed, total: items.length });
          const result = await importProvisionMutation.mutateAsync({
            catalogId: catalog.id,
            documentId: item.documentId,
            locator: item.locator,
            expectedRevision: currentRev,
          });
          currentRev = result.catalogRevision;
        }
      }

      await queryClient.invalidateQueries({ queryKey: legalRuleCatalogKey });
      setSelectedProvisions(new Map());
      setSavingProgress(null);
      onImported?.();
      onOpenChange(false);
    } catch (err: unknown) {
      const message =
        err instanceof ApiRequestError && err.problemCode
          ? `${t("error")}: ${err.problemCode}`
          : err instanceof Error
            ? err.message
            : t("error");
      setSaveError(message);
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
                  setProvisionPage(1);
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
                    const pickedCount =
                      countsByDocId.get(`${effectiveVersionId}::${doc.documentId}`) ?? 0;
                    return (
                      <button
                        key={doc.id}
                        type="button"
                        onClick={() => {
                          setActiveDocId(doc.id);
                          setProvisionPage(1);
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
                      {totalProvisionCount} {t("eligibleLeafProvisions")} · {t("page")} {provisionPage}/{totalPages}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={selectAllInCurrentPage}
                      disabled={!provisions.length || savingProgress !== null}
                    >
                      {t("selectAllInPage")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs"
                      onClick={deselectCurrentDoc}
                      disabled={
                        !countsByDocId.get(
                          `${effectiveVersionId}::${activeDoc?.documentId ?? ""}`,
                        ) ||
                        savingProgress !== null
                      }
                    >
                      {t("deselectAll")}
                    </Button>
                  </div>
                </div>

                {/* Provisions items list */}
                <div className="min-h-0 flex-1 divide-y overflow-y-auto pr-1">
                {provisionsQuery.isPending ? (
                  <div className="space-y-3 p-4">
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-14 w-full" />
                  </div>
                ) : provisionsQuery.isError ? (
                  <p className="py-8 text-center text-sm text-destructive">
                    {t("error")}
                  </p>
                ) : provisions.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {t(
                      hasNonEffectiveStatus
                        ? "noEligibleEffectiveProvisions"
                        : "noChunksInDocument",
                    )}
                  </p>
                ) : (
                  provisions.map((provision) => {
                    const isChecked = selectedProvisions.has(provision.legalRuleId);
                    const levelMessageKey = {
                      [LEGAL_RULE_SOURCE_PROVISION_LEVELS.ARTICLE]: "articleLevel",
                      [LEGAL_RULE_SOURCE_PROVISION_LEVELS.CLAUSE]: "clauseLevel",
                      [LEGAL_RULE_SOURCE_PROVISION_LEVELS.POINT]: "pointLevel",
                    }[provision.level];
                    return (
                      <div
                        key={provision.legalRuleId}
                        onClick={() =>
                          activeDoc && toggleProvision(provision, activeDoc)
                        }
                        className={`flex cursor-pointer items-start gap-3 p-3 transition-colors hover:bg-muted/30 ${
                          isChecked ? "bg-muted/20" : ""
                        }`}
                      >
                        <Checkbox
                          id={`rule-${provision.legalRuleId}`}
                          checked={isChecked}
                          onClick={(event) => event.stopPropagation()}
                          onCheckedChange={() =>
                            activeDoc && toggleProvision(provision, activeDoc)
                          }
                          className="mt-1"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-semibold text-primary">
                              {formatLocator(provision.locator)}
                            </span>
                            <Badge variant="outline" className="text-xs">
                              {t(levelMessageKey)}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs font-medium text-foreground">
                            {t("compositionPreview")}
                          </p>
                          <p className="mt-1 line-clamp-5 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                            {formatLegalProvisions(provision.description)}
                          </p>
                          {/* Match the current version and document before using its recorded web source. */}
                          <LegalRuleReferencePreview
                            provision={provision}
                            sourceDocument={
                              versionQuery.data?.id === provision.sourceVersionId &&
                              activeDoc?.documentId === provision.documentId
                                ? activeDoc
                                : null
                            }
                          />
                        </div>
                      </div>
                    );
                  })
                )}
                {hasNonEffectiveStatus ? (
                  <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                    {t("sourceEffectNotEligibleNotice")}
                  </p>
                ) : null}
                {hasOtherLimitations ? (
                  <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                    {t("unresolvedContentNotice")}
                  </p>
                ) : null}
              </div>

              {/* Pagination */}
              {totalPages > 1 ? (
                <div className="flex items-center justify-between border-t pt-2 text-xs">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={provisionPage <= 1 || provisionsQuery.isFetching}
                    onClick={() => setProvisionPage((p) => Math.max(1, p - 1))}
                  >
                    {t("previous")}
                  </Button>
                  <span className="text-muted-foreground">
                    {t("page")} {provisionPage} / {totalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={provisionPage >= totalPages || provisionsQuery.isFetching}
                    onClick={() =>
                      setProvisionPage((p) => Math.min(totalPages, p + 1))
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
                <strong className="font-semibold text-foreground">
                  {selectedProvisions.size}
                </strong>{" "}
                {t("selectedProvisionsCount")} ·{" "}
                <strong className="font-semibold text-foreground">
                  {uniqueFilesCount}
                </strong>{" "}
                {t("selectedDocumentFiles")}
              </span>
            ) : (
              <span>{t("noSelection")}</span>
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
                selectedProvisions.size === 0 ||
                savingProgress !== null ||
                !catalogsQuery.isSuccess
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
