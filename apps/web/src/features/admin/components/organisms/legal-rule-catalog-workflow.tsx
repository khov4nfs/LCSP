"use client";
import { useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FileTextIcon } from "lucide-react";
import {
  LEGAL_RULE_PREPARATION_STATES as STATES,
  LEGAL_RULE_SELECTION_MODES as MODES,
  legalRuleSelectionResultSchema,
  preparationRuleBatchSchema,
  type LegalRuleFilter,
  type LegalRuleListItem,
} from "@lcsp/contracts/legal-rule-catalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  useLegalRuleCatalogs,
  useLegalRules,
  useLegalRuleCommand,
} from "@/lib/api/legal-rule-catalog-queries";
import { useLegalSourceListQuery } from "@/lib/api/legal-source-queries";
import { catalogMessage as t } from "../../utils/legal-rule-catalog-message";
import { LEGAL_RULE_FILTER_ALL } from "../../config/legal-rule-catalog.config";
import {
  LegalRuleCatalogCreateForm,
  LegalRuleCatalogRuleForm,
} from "../molecules/legal-rule-catalog-forms";
import { LegalRuleResultDialog } from "../molecules/legal-rule-catalog-result";
import { LegalRuleCatalogBatch } from "./legal-rule-catalog-batch";
import { LegalRuleSourcePickerDialog } from "./legal-rule-source-picker-dialog";

/**
 * Business purpose: Build a Preparation Rule Set from explicitly selected canonical rules after chunking.
 * Business rules:
 * - No rule starts selected; selection persists across server pages/filters, and all-matching is resolved by the server.
 * Execution flow:
 * 1. Choose/edit the catalog
 * 2. Select eligible rules
 * 3. Persist and confirm exact scope
 * 4. Observe the build and inspect/regenerate individual results.
 * Failure cases:
 * - Empty, stale and ineligible selections cannot submit; request failures retain inputs and stable submission identity.
 * Side effects:
 * - Catalog/query subscriptions and explicitly invoked authoring, selection, bulk and regeneration API operations.
 */
export function LegalRuleCatalogWorkflow({
  sourceId,
}: {
  sourceId: string | null;
}) {
  const catalogs = useLegalRuleCatalogs();
  const [selectedCatalogId, setSelectedCatalogId] = useState("");
  const catalogId =
    selectedCatalogId ||
    (sourceId
      ? catalogs.data?.find((c) => c.legalSourceVersionId === sourceId)?.id
      : null) ||
    catalogs.data?.[0]?.id ||
    "";
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<LegalRuleFilter>({ search: "" });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<LegalRuleListItem | null | undefined>(
    undefined,
  );
  const [inspectedRule, setInspectedRule] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const batchId = useSearchParams().get("preparationBatchId");
  const [confirming, setConfirming] = useState(false);
  const [snapshot, setSnapshot] = useState<ReturnType<
    typeof legalRuleSelectionResultSchema.parse
  > | null>(null);
  const submissionKey = useRef("");
  const rules = useLegalRules(catalogId, { ...filters, page, limit: 50 });
  const isCatalogEmpty =
    rules.data?.total === 0 && !filters.search && !filters.state;
  const selection = useLegalRuleCommand(
    "/selections",
    legalRuleSelectionResultSchema,
  );
  const submit = useLegalRuleCommand(
    "/preparations",
    preparationRuleBatchSchema,
  );
  const sourcesQuery = useLegalSourceListQuery();
  const sourceNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const src of sourcesQuery.data?.items ?? []) {
      if (src.activeVersion) map.set(src.activeVersion.id, src.name);
      if (src.latestVersion) map.set(src.latestVersion.id, src.name);
    }
    return map;
  }, [sourcesQuery.data]);

  const currentCatalog = catalogs.data?.find(
    (catalog) => catalog.id === catalogId,
  );
  const busy = selection.isPending || submit.isPending;

  /**
   * Business purpose: Keep the acknowledged Preparation Rule Set reopenable after a page refresh.
   * Business rules:
   * - A URL identity only reads an existing batch; opening it never dispatches preparation.
   * Execution flow:
   * 1. Replace the batch query parameter with the acknowledged identity.
   * Failure cases:
   * - Missing or inaccessible batch identities are handled by the existing batch read boundary.
   * Side effects:
   * - Updates the current browser URL without creating domain state.
   */
  function showBatch(id: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("preparationBatchId", id);
    window.history.replaceState(null, "", url);
  }

  /**
   * Business purpose: Clear only the current selection without starting or cancelling preparation.
   * Business rules:
   * - Persisted batches/results remain intact.
   * Execution flow:
   * 1. Reset selected IDs, revision and pending confirmation snapshot.
   * Failure cases:
   * - None; this is local selection state only.
   * Side effects:
   * - Updates local UI state.
   */
  function clearSelection() {
    setSelectedIds(new Set());
    setSelectedRevision(null);
    setSnapshot(null);
  }

  /**
   * Business purpose: Toggle one canonical ID while preserving selection on other server pages.
   * Business rules:
   * - Ineligible rows are disabled; the first selected page pins the expected catalog revision.
   * Execution flow:
   * 1. Copy the ID set
   * 2. Toggle this ID
   * 3. Invalidate the old preview and retain revision guards.
   * Failure cases:
   * - A later catalog edit is rejected by the server when previewing this selection.
   * Side effects:
   * - Updates local selection only; no model work or preparation artifact.
   */
  function toggleRule(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
    setSnapshot(null);
    setSelectedRevision(
      next.size ? (selectedRevision ?? rules.data!.catalogRevision) : null,
    );
  }

  /**
   * Business purpose: Resolve all matching eligible IDs across the complete server result set.
   * Business rules:
   * - This explicit action replaces the local selection with the exact server snapshot, independent of page size.
   * Execution flow:
   * 1. Request an all-matching preview
   * 2. Retain acknowledged IDs, revision and scope.
   * Failure cases:
   * - Empty/stale/unavailable results keep the previous selection and show a request error.
   * Side effects:
   * - Persists a selection preview only; no preparation dispatch.
   */
  async function selectAll() {
    if (!rules.data) return;
    const result = await selection
      .mutateAsync({
        catalogVersionId: catalogId,
        expectedRevision: rules.data.catalogRevision,
        mode: MODES.ALL_MATCHING,
        filters,
        ruleIds: [],
      })
      .catch(() => null);
    if (result) {
      setSelectedIds(new Set(result.ruleIds));
      setSelectedRevision(result.catalogRevision);
      setSnapshot(result);
    }
  }

  /**
   * Business purpose: Present an exact persisted selection for confirmation before dispatch.
   * Business rules:
   * - Empty selections cannot submit; unchanged all-matching selections retain their original filter scope.
   * Execution flow:
   * 1. Reuse or persist the exact selected IDs
   * 2. Create one stable submission key
   * 3. Open confirmation.
   * Failure cases:
   * - Revision/source validation errors leave the selection visible and do not create model work.
   * Side effects:
   * - May persist a selection preview and changes local confirmation state.
   */
  async function previewSelection() {
    if (!selectedIds.size || !selectedRevision) return;
    const result =
      snapshot ??
      (await selection
        .mutateAsync({
          catalogVersionId: catalogId,
          expectedRevision: selectedRevision,
          mode: MODES.EXPLICIT,
          filters,
          ruleIds: [...selectedIds],
        })
        .catch(() => null));
    if (result) {
      setSnapshot(result);
      submissionKey.current = crypto.randomUUID();
      setConfirming(true);
    }
  }

  /**
   * Business purpose: Submit only the administrator-confirmed snapshot as one idempotent build.
   * Business rules:
   * - Stable request identity survives transport failure; acknowledgement alone changes the displayed batch.
   * Execution flow:
   * 1. Send selection and request key
   * 2. Show the acknowledged build
   * 3. Clear the consumed local selection.
   * Failure cases:
   * - Failed submissions retain the same confirmation and request key for safe replay.
   * Side effects:
   * - Dispatches the explicit selected-rule build through the API and updates local UI state.
   */
  async function confirmSelection() {
    if (!snapshot) return;
    const result = await submit
      .mutateAsync({
        selectionId: snapshot.selectionId,
        idempotencyKey: submissionKey.current,
      })
      .catch(() => null);
    if (result) {
      showBatch(result.id);
      setConfirming(false);
      clearSelection();
    }
  }

  return (
    <section
      className="space-y-4 rounded-xl border-l-4 border-primary bg-card p-4 shadow-sm sm:p-6"
      data-testid="rule-set-preparation-entry-point"
      aria-label={t("title")}
    >
      <div>
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>
      {catalogs.isPending ? <p role="status">{t("loading")}</p> : null}
      {catalogs.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{t("error")}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-60 flex-1 space-y-2">
          <Label>{t("catalog")}</Label>
          <Select
            value={catalogId}
            onValueChange={(id) => {
              setSelectedCatalogId(id ?? "");
              setPage(1);
              clearSelection();
            }}
          >
            <SelectTrigger aria-label={t("catalog")}>
              <SelectValue placeholder={t("chooseCatalog")}>
                {currentCatalog
                  ? `${currentCatalog.version} · rev ${currentCatalog.revision}${sourceNameMap.get(currentCatalog.legalSourceVersionId) ? ` (${sourceNameMap.get(currentCatalog.legalSourceVersionId)})` : ""}`
                  : t("chooseCatalog")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {catalogs.data?.map((catalog) => (
                <SelectItem key={catalog.id} value={catalog.id}>
                  {catalog.version} · rev {catalog.revision}
                  {sourceNameMap.get(catalog.legalSourceVersionId)
                    ? ` (${sourceNameMap.get(catalog.legalSourceVersionId)})`
                    : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={() => setCreateOpen(true)}>
          {t("createCatalog")}
        </Button>
        {!isCatalogEmpty && catalogId ? (
          <>
            <Button
              variant="default"
              disabled={!catalogId}
              onClick={() => setPickerOpen(true)}
            >
              <FileTextIcon className="mr-2 size-4" />
              {t("browseSourceDocuments")}
            </Button>
            <Button
              variant="outline"
              disabled={!rules.data}
              onClick={() => setEditing(null)}
            >
              {t("addRule")}
            </Button>
          </>
        ) : null}
      </div>
      {catalogs.data?.length === 0 ? (
        <p role="status">{t("emptyCatalog")}</p>
      ) : null}
      {catalogId ? (
        isCatalogEmpty ? (
          <div
            role="status"
            className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border/70 bg-muted/15 p-12 text-center"
          >
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <FileTextIcon className="size-6" />
            </div>
            <div className="max-w-md space-y-1">
              <h3 className="text-base font-semibold">
                {t("emptyCatalogRulesTitle")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t("emptyCatalogRules")}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <Button
                variant="default"
                disabled={!catalogId}
                onClick={() => setPickerOpen(true)}
              >
                <FileTextIcon className="mr-2 size-4" />
                {t("browseSourceDocuments")}
              </Button>
              <Button variant="outline" onClick={() => setEditing(null)}>
                {t("manualAddRule")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="legal-rule-search">{t("search")}</Label>
                <Input
                  id="legal-rule-search"
                  value={filters.search}
                  onChange={(event) => {
                    setFilters({ ...filters, search: event.target.value });
                    setPage(1);
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("status")}</Label>
                <Select
                  value={filters.state ?? LEGAL_RULE_FILTER_ALL}
                  onValueChange={(value) => {
                    setFilters({
                      ...filters,
                      state:
                        value === LEGAL_RULE_FILTER_ALL
                          ? undefined
                          : (value as LegalRuleFilter["state"]),
                    });
                    setPage(1);
                  }}
                >
                  <SelectTrigger aria-label={t("status")}>
                    <SelectValue>
                      {filters.state
                        ? t(`state_${filters.state}`)
                        : t("allStates")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={LEGAL_RULE_FILTER_ALL}>
                      {t("allStates")}
                    </SelectItem>
                    {Object.values(STATES).map((state) => (
                      <SelectItem key={state} value={state}>
                        {t(`state_${state}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                disabled={busy || !rules.data?.eligibleTotal}
                onClick={() => void selectAll()}
              >
                {t("selectAll")}
              </Button>
              <Button
                variant="ghost"
                disabled={!selectedIds.size || busy}
                onClick={clearSelection}
              >
                {t("clear")}
              </Button>
              <span role="status">
                {t("selected")}:{" "}
                <strong data-testid="legal-rule-selected-count">
                  {selectedIds.size}
                </strong>
              </span>
              <Button
                disabled={!selectedIds.size || busy}
                onClick={() => void previewSelection()}
              >
                {busy ? t("loading") : t("prepare")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("acrossPages")}</p>
            {selection.isError || rules.isError ? (
              <Alert variant="destructive">
                <AlertDescription>{t("error")}</AlertDescription>
              </Alert>
            ) : null}
            {rules.isPending ? <p role="status">{t("loading")}</p> : null}
            <ul className="divide-y">
              {rules.data?.items.map((rule) => (
                <li key={rule.id} className="flex items-start gap-3 py-4">
                  <Checkbox
                    id={`select-${rule.id}`}
                    aria-label={`${t("selectRule")} ${rule.legalRuleId}`}
                    checked={selectedIds.has(rule.id)}
                    disabled={!!rule.ineligibleReason || busy}
                    onCheckedChange={() => toggleRule(rule.id)}
                  />
                  <div className="min-w-0 flex-1">
                    <Label
                      htmlFor={`select-${rule.id}`}
                      className="font-semibold"
                    >
                      {rule.legalRuleId} · {rule.title}
                    </Label>
                    <p className="mt-1 text-sm">{rule.description}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {currentCatalog?.version} · {t(`state_${rule.state}`)}
                    </p>
                    <ul className="mt-1 text-xs text-muted-foreground">
                      {rule.citationLocatorRefs.map((ref) => (
                        <li key={`${ref.documentId}:${ref.locator}`}>
                          {ref.documentId} · {ref.locator}
                        </li>
                      ))}
                    </ul>
                    {rule.ineligibleReason ? (
                      <p className="mt-1 text-sm text-destructive">
                        {t(`reason_${rule.ineligibleReason}`)}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing(rule)}
                      >
                        {t("editRule")}
                      </Button>
                      {rule.lastResultId ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setInspectedRule(rule.id)}
                        >
                          {t("viewResult")}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {rules.data?.items.length === 0 ? (
              <p role="status">{t("empty")}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                disabled={page === 1 || rules.isFetching}
                onClick={() => setPage((value) => value - 1)}
              >
                {t("previous")}
              </Button>
              <span>
                {t("page")} {page} · {t("total")}: {rules.data?.total ?? 0}
              </span>
              <Button
                variant="outline"
                disabled={
                  !rules.data ||
                  page * rules.data.limit >= rules.data.total ||
                  rules.isFetching
                }
                onClick={() => setPage((value) => value + 1)}
              >
                {t("next")}
              </Button>
            </div>
          </>
        )
      ) : null}
      {batchId ? (
        <LegalRuleCatalogBatch
          key={batchId}
          batchId={batchId}
          onInspect={setInspectedRule}
          onBatch={showBatch}
        />
      ) : null}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader className="flex flex-col gap-1.5 border-b pb-4">
            <DialogTitle>{t("createCatalog")}</DialogTitle>
            <DialogDescription>
              {t("createCatalogDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="p-6">
            <LegalRuleCatalogCreateForm
              sourceId={sourceId ?? ""}
              onCreated={(id) => {
                setSelectedCatalogId(id);
                setCreateOpen(false);
                setPage(1);
                clearSelection();
              }}
            />
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader className="flex flex-col gap-1.5 border-b pb-4">
            <DialogTitle>{editing ? t("editRule") : t("addRule")}</DialogTitle>
            <DialogDescription>{t("citationHelp")}</DialogDescription>
          </DialogHeader>
          <div className="p-6">
            {editing !== undefined && rules.data ? (
              <LegalRuleCatalogRuleForm
                key={editing?.id ?? "NEW"}
                catalogId={catalogId}
                revision={rules.data.catalogRevision}
                rule={editing}
                onSaved={() => setEditing(undefined)}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader className="flex flex-col gap-1.5 border-b pb-4">
            <DialogTitle>{t("confirm")}</DialogTitle>
            <DialogDescription>{t("confirmDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 p-6">
            <p>
              {t("confirmCount")}: <strong>{snapshot?.selectedCount}</strong>
            </p>
            <p className="text-sm text-muted-foreground">
              {currentCatalog?.version} · rev {snapshot?.catalogRevision}
            </p>
            <details className="rounded-lg border bg-muted/20 p-3">
              <summary className="cursor-pointer text-xs font-medium">
                {t("confirmScope")}
              </summary>
              <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
                {JSON.stringify(snapshot?.scope, null, 2)}
              </pre>
              <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                {snapshot?.ruleIds.join("\n")}
              </p>
            </details>
            {submit.isError ? (
              <Alert variant="destructive">
                <AlertDescription>{t("error")}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter className="px-6 pb-6">
            <Button
              variant="outline"
              disabled={submit.isPending}
              onClick={() => setConfirming(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              disabled={submit.isPending || !snapshot?.selectedCount}
              onClick={() => void confirmSelection()}
            >
              {submit.isPending ? t("loading") : t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {inspectedRule ? (
        <LegalRuleResultDialog
          key={inspectedRule}
          ruleId={inspectedRule}
          onClose={() => setInspectedRule(null)}
          onBatch={showBatch}
        />
      ) : null}
      {pickerOpen && catalogId ? (
        <LegalRuleSourcePickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          catalogId={catalogId}
          catalogRevision={
            rules.data?.catalogRevision ?? currentCatalog?.revision ?? 1
          }
          initialLegalSourceVersionId={currentCatalog?.legalSourceVersionId}
          onImported={() => {
            void rules.refetch();
            void catalogs.refetch();
          }}
        />
      ) : null}
    </section>
  );
}
