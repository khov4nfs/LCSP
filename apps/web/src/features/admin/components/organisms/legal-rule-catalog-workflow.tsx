"use client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useComplianceRuleSetHistoryQuery } from "@/lib/api/compliance-rule-set-queries";
import {
  useDeleteLegalRuleCatalog,
  useLegalRuleActivation,
  useLegalRuleActivationSelection,
  useLegalRuleCatalogs,
  useLegalRuleCommand,
  useLegalRules,
} from "@/lib/api/legal-rule-catalog-queries";
import { ARTIFACT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import {
  LEGAL_RULE_SELECTION_MODES as MODES,
  LEGAL_RULE_PREPARATION_STATES as STATES,
  legalRuleSelectionResultSchema,
  preparationRuleBatchSchema,
  type LegalRuleActivationResult,
  type LegalRuleFilter,
  type LegalRuleListItem,
} from "@lcsp/contracts/legal-rule-catalog";
import { FileTextIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import {
  LEGAL_RULE_FILTER_ALL,
  LEGAL_RULE_FILTER_PREPARED_WITH_ASSESSMENT_RULES,
} from "../../config/legal-rule-catalog.config";
import { catalogMessage as t } from "../../utils/legal-rule-catalog-message";
import {
  formatLegalProvisions,
  getRuleDisplayTitle,
} from "../../utils/legal-rule-formatter";
import { selectLegalRulePreparationFilter } from "../../utils/legal-rule-preparation-filter";
import {
  LegalRuleCatalogCreateForm,
  LegalRuleCatalogRuleForm,
} from "../molecules/legal-rule-catalog-forms";
import { LegalRuleResultDialog } from "../molecules/legal-rule-catalog-result";
import { AssessmentRuleImportDialog } from "./assessment-rule-import-dialog";
import { LegalRuleCatalogBatch } from "./legal-rule-catalog-batch";
import { LegalRuleSourcePickerDialog } from "./legal-rule-source-picker-dialog";
import { SelectedScopeAuthorizationDialog } from "./selected-scope-authorization-dialog";

/**
 * Business purpose: Build a Preparation Rule Set from explicitly selected canonical rules after chunking.
 * Business rules:
 * - No rule starts selected; build and activation selections persist across server pages/filters. The normal list exposes Preparation selection, while the prepared-with-rules filter exposes activation selection, so each row has one action-specific checkbox.
 * - Assessment Rule filtering and activation candidates reflect only current successful persisted outputs. Selecting all in activation mode includes every matching page.
 * Execution flow:
 * 1. Choose/edit the catalog
 * 2. Select eligible rules
 * 3. Review and confirm the exact Preparation or activation scope
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
  const [activationSelection, setActivationSelection] = useState<
    Map<string, LegalRuleListItem>
  >(new Map());
  const [activationRevision, setActivationRevision] = useState<number | null>(
    null,
  );
  const [activationConfirming, setActivationConfirming] = useState(false);
  const [activationSuccess, setActivationSuccess] =
    useState<LegalRuleActivationResult | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<LegalRuleListItem | null | undefined>(
    undefined,
  );
  const [inspectedRule, setInspectedRule] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const batchId = useSearchParams()?.get("preparationBatchId") ?? null;
  const [confirming, setConfirming] = useState(false);
  const [snapshot, setSnapshot] = useState<ReturnType<
    typeof legalRuleSelectionResultSchema.parse
  > | null>(null);
  const [scopeAuthRuleId, setScopeAuthRuleId] = useState<string | null>(null);
  const submissionKey = useRef("");
  const activationSubmissionKey = useRef("");
  const ruleSetHistory = useComplianceRuleSetHistoryQuery();
  const currentActiveRuleSet = ruleSetHistory.data?.ruleSets.find(
    (item) => item.lifecycleState === ARTIFACT_LIFECYCLE_STATES.ACTIVE,
  );
  const rules = useLegalRules(catalogId, { ...filters, page, limit: 50 });
  const isCatalogEmpty =
    rules.data?.total === 0 &&
    !filters.search &&
    !filters.state &&
    !filters.withAssessmentRules;
  const selection = useLegalRuleCommand(
    "/selections",
    legalRuleSelectionResultSchema,
  );
  const submit = useLegalRuleCommand(
    "/preparations",
    preparationRuleBatchSchema,
  );
  const activate = useLegalRuleActivation(catalogId);
  const activationCandidates = useLegalRuleActivationSelection(catalogId);
  const deleteMutation = useDeleteLegalRuleCatalog();

  const currentCatalog = catalogs.data?.find(
    (catalog) => catalog.id === catalogId,
  );
  // Freeze selection controls while matching activation results are being collected across pages.
  const selectingAllForActivation = activationCandidates.isPending;
  const busy =
    selection.isPending ||
    submit.isPending ||
    activate.isPending ||
    selectingAllForActivation;
  const selectingForActivation = filters.withAssessmentRules === true;
  const selectedAssessmentRuleCount = [...activationSelection.values()].reduce(
    (total, item) => total + item.assessmentRuleCount,
    0,
  );

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
   * - Persisted batches/results remain intact; local build and activation selections are both cleared.
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
    setActivationSelection(new Map());
    setActivationRevision(null);
    setActivationConfirming(false);
    setActivationSuccess(null);
  }

  /**
   * Business purpose: Retain one exact prepared result revision for explicit activation confirmation.
   *
   * Business rules:
   * - Only current PREPARED rows with a positive persisted Assessment Rule count are selectable; one catalog revision owns the cross-page selection.
   *
   * Execution flow:
   * 1. Ignore a row missing its current result identity or revision.
   * 2. Toggle the exact result identity in a copied selection map.
   * 3. Pin or clear the catalog revision and reset any prior confirmation result.
   *
   * Failure cases:
   * - Ineligible or zero-rule rows cannot enter the activation selection.
   *
   * Side effects:
   * - Updates local Admin selection only; no publication occurs until the confirmation action.
   */
  function toggleActivationRule(rule: LegalRuleListItem) {
    if (
      rule.state !== STATES.PREPARED ||
      rule.assessmentRuleCount <= 0 ||
      !rule.lastResultId ||
      !rule.lastResultRevision ||
      !rules.data
    )
      return;
    if (
      activationRevision !== null &&
      activationRevision !== rules.data.catalogRevision
    )
      return;
    const next = new Map(activationSelection);
    if (next.has(rule.id)) next.delete(rule.id);
    else next.set(rule.id, rule);
    setActivationSelection(next);
    setActivationRevision(
      next.size ? (activationRevision ?? rules.data.catalogRevision) : null,
    );
    setActivationSuccess(null);
    activationSubmissionKey.current = "";
  }

  /**
   * Business purpose: Select every prepared result matching the Admin's current catalog filters for one confirmation.
   * Business rules:
   * - A complete bulk selection replaces the current activation selection. The displayed catalog revision and exact result identities are retained for server revalidation.
   * Execution flow:
   * 1. Request the complete set of matching prepared results at the displayed catalog revision.
   * 2. Replace the checked results and pin their catalog revision once the read succeeds.
   * Failure cases:
   * - A failed or stale read leaves the previous selection intact and displays the catalog error.
   * Side effects:
   * - Reads catalog data and updates local activation state. Publication requires explicit confirmation.
   */
  async function selectAllActivationRules() {
    if (!rules.data?.total) return;
    const expectedRevision = rules.data.catalogRevision;
    const candidates = await activationCandidates
      .mutateAsync({ filters, expectedRevision })
      .catch(() => null);
    if (!candidates) return;

    setActivationSelection(candidates);
    setActivationRevision(expectedRevision);
    setActivationSuccess(null);
    activationSubmissionKey.current = "";
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

  /**
   * Business purpose: Activate the exact prepared result revisions after the Admin reviews the replacement warning and rule count.
   *
   * Business rules:
   * - The stable request key and selected revision identities are reused after transport failure; only a validated server acknowledgement is success.
   * - No unselected, failed, stale, or zero-rule catalog entries are submitted.
   *
   * Execution flow:
   * 1. Submit the selected result manifest and pinned catalog revision.
   * 2. Keep selection and idempotency identity on failure for safe retry.
   * 3. On acknowledgement, display the published version and clear local activation selection.
   *
   * Failure cases:
   * - Server freshness, eligibility, source, validation, authorization, and network errors remain visible without an optimistic success state.
   *
   * Side effects:
   * - Requests canonical Rule Set publication; the server owns the ACTIVE lifecycle and cache invalidation.
   */
  async function confirmActivation() {
    if (!activationSelection.size || activationRevision === null) return;
    if (!activationSubmissionKey.current)
      activationSubmissionKey.current = crypto.randomUUID();
    const result = await activate
      .mutateAsync({
        expectedRevision: activationRevision,
        idempotencyKey: activationSubmissionKey.current,
        results: [...activationSelection.values()].flatMap((rule) =>
          rule.lastResultId && rule.lastResultRevision
            ? [
                {
                  ruleId: rule.id,
                  resultId: rule.lastResultId,
                  revision: rule.lastResultRevision,
                },
              ]
            : [],
        ),
      })
      .catch(() => null);
    if (result) {
      setActivationSuccess(result);
      setActivationConfirming(false);
      setActivationSelection(new Map());
      setActivationRevision(null);
      activationSubmissionKey.current = "";
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
            disabled={selectingAllForActivation}
            onValueChange={(id) => {
              setSelectedCatalogId(id ?? "");
              setPage(1);
              clearSelection();
            }}
          >
            <SelectTrigger aria-label={t("catalog")}>
              <SelectValue placeholder={t("chooseCatalog")}>
                {currentCatalog
                  ? `${currentCatalog.version} · ${currentCatalog.revision}`
                  : t("chooseCatalog")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {catalogs.data?.map((catalog) => (
                <SelectItem key={catalog.id} value={catalog.id}>
                  {catalog.version} · {catalog.revision}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          disabled={selectingAllForActivation}
          onClick={() => setCreateOpen(true)}
        >
          {t("createCatalog")}
        </Button>
        {catalogId ? (
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
            <Button
              variant="outline"
              disabled={!rules.data}
              onClick={() => setImportOpen(true)}
            >
              <UploadIcon className="mr-2 size-4" />
              {t("importAssessmentRules")}
            </Button>
            <Button
              variant="outline"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={deleteMutation.isPending || selectingAllForActivation}
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2Icon className="mr-2 size-4" />
              {t("deleteCatalog")}
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
                  disabled={selectingAllForActivation}
                  onChange={(event) => {
                    setFilters({ ...filters, search: event.target.value });
                    setPage(1);
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("status")}</Label>
                <Select
                  disabled={selectingAllForActivation}
                  value={
                    filters.withAssessmentRules
                      ? LEGAL_RULE_FILTER_PREPARED_WITH_ASSESSMENT_RULES
                      : (filters.state ?? LEGAL_RULE_FILTER_ALL)
                  }
                  onValueChange={(value) => {
                    setFilters((current) =>
                      selectLegalRulePreparationFilter(current, value),
                    );
                    setPage(1);
                  }}
                >
                  <SelectTrigger aria-label={t("status")}>
                    <SelectValue>
                      {filters.withAssessmentRules
                        ? t("preparedWithAssessmentRules")
                        : filters.state
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
                    <SelectItem
                      value={LEGAL_RULE_FILTER_PREPARED_WITH_ASSESSMENT_RULES}
                    >
                      {t("preparedWithAssessmentRules")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {/* Each mode resolves the whole filtered catalog using its own eligibility and selection state. */}
              <Button
                variant="outline"
                disabled={
                  busy ||
                  !(selectingForActivation
                    ? rules.data?.total
                    : rules.data?.eligibleTotal)
                }
                onClick={() =>
                  void (selectingForActivation
                    ? selectAllActivationRules()
                    : selectAll())
                }
              >
                {selectingAllForActivation ? t("loading") : t("selectAll")}
              </Button>
              <Button
                variant="ghost"
                disabled={
                  (!selectedIds.size && !activationSelection.size) || busy
                }
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
              {!selectingForActivation ? (
                <Button
                  disabled={!selectedIds.size || busy}
                  onClick={() => void previewSelection()}
                >
                  {busy ? t("loading") : t("prepare")}
                </Button>
              ) : null}
              {selectingForActivation ? (
                <Button
                  variant="destructive"
                  disabled={
                    !activationSelection.size ||
                    !ruleSetHistory.isSuccess ||
                    busy
                  }
                  onClick={() => setActivationConfirming(true)}
                >
                  {t("activateSelectedAssessmentRules")}
                </Button>
              ) : null}
            </div>
            {activationSelection.size ? (
              <p className="text-sm text-muted-foreground" role="status">
                {t("activationSelectedCount")}: {activationSelection.size} ·{" "}
                {t("assessmentRuleCount")}: {selectedAssessmentRuleCount}
              </p>
            ) : null}
            {activationSuccess ? (
              <Alert>
                <AlertDescription>
                  {t("activationSuccess")}: {activationSuccess.version}
                </AlertDescription>
              </Alert>
            ) : null}
            <p className="text-xs text-muted-foreground">{t("acrossPages")}</p>
            {selection.isError ||
            (selectingForActivation && activationCandidates.isError) ||
            rules.isError ||
            activate.isError ||
            ruleSetHistory.isError ? (
              <Alert variant="destructive">
                <AlertDescription>{t("error")}</AlertDescription>
              </Alert>
            ) : null}
            {rules.isPending ? <p role="status">{t("loading")}</p> : null}
            <ul className="divide-y">
              {rules.data?.items.map((rule) => (
                <li key={rule.id} className="flex items-start gap-3 py-4">
                  <div className="flex flex-col gap-3 pt-1">
                    {selectingForActivation ? (
                      rule.state === STATES.PREPARED &&
                      rule.assessmentRuleCount > 0 ? (
                        <Checkbox
                          id={`activate-${rule.id}`}
                          aria-label={`${t("selectForActivation")} ${getRuleDisplayTitle(rule)}`}
                          checked={activationSelection.has(rule.id)}
                          disabled={busy}
                          onCheckedChange={() => toggleActivationRule(rule)}
                        />
                      ) : null
                    ) : (
                      <Checkbox
                        id={`select-${rule.id}`}
                        aria-label={`${t("selectRule")} ${getRuleDisplayTitle(rule)}`}
                        checked={selectedIds.has(rule.id)}
                        disabled={!!rule.ineligibleReason || busy}
                        onCheckedChange={() => toggleRule(rule.id)}
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <Label
                      htmlFor={`select-${rule.id}`}
                      className="font-semibold"
                    >
                      {getRuleDisplayTitle(rule)}
                    </Label>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("assessmentRuleCount")}: {rule.assessmentRuleCount}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap">
                      {formatLegalProvisions(rule.description)}
                    </p>
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
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setScopeAuthRuleId(rule.id)}
                      >
                        {t("scopeAuthAction")}
                      </Button>
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
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="flex flex-col gap-1.5 border-b pb-4">
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2Icon className="size-5" />
              {t("deleteCatalogTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("deleteCatalogDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 p-6">
            {deleteMutation.isError ? (
              <Alert variant="destructive">
                <AlertDescription>
                  {t("deleteCatalogConflict")}
                </AlertDescription>
              </Alert>
            ) : null}
            <DialogFooter className="flex flex-row justify-end gap-2 pt-2">
              <Button
                variant="outline"
                disabled={deleteMutation.isPending}
                onClick={() => setDeleteOpen(false)}
              >
                {t("cancel")}
              </Button>
              <Button
                variant="destructive"
                disabled={deleteMutation.isPending}
                onClick={async () => {
                  if (!catalogId) return;
                  const res = await deleteMutation
                    .mutateAsync(catalogId)
                    .catch(() => null);
                  if (res) {
                    setDeleteOpen(false);
                    setSelectedCatalogId("");
                    setPage(1);
                    clearSelection();
                  }
                }}
              >
                {deleteMutation.isPending
                  ? t("loading")
                  : t("deleteCatalogConfirm")}
              </Button>
            </DialogFooter>
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
              <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap wrap-break-word text-xs text-muted-foreground">
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
      <Dialog
        open={activationConfirming}
        onOpenChange={setActivationConfirming}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader className="flex flex-col gap-1.5 border-b pb-4">
            <DialogTitle>{t("activateConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("activateConfirmDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 p-6">
            <p>
              {t("activationSelectedCount")}:{" "}
              <strong>{activationSelection.size}</strong>
            </p>
            <p>
              {t("assessmentRuleCount")}:{" "}
              <strong>{selectedAssessmentRuleCount}</strong>
            </p>
            <p>
              {t("currentActiveRuleCount")}:{" "}
              <strong>{currentActiveRuleSet?.assessmentRuleCount ?? 0}</strong>
            </p>
            <p className="text-sm text-muted-foreground">
              {t("activateConfirmImpact")}
            </p>
            <p className="text-sm text-muted-foreground">
              {currentActiveRuleSet?.version ?? t("noActiveRuleSet")}
            </p>
            {activate.isError || ruleSetHistory.isError ? (
              <Alert variant="destructive">
                <AlertDescription>{t("error")}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter className="px-6 pb-6">
            <Button
              variant="outline"
              disabled={activate.isPending}
              onClick={() => setActivationConfirming(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={
                !activationSelection.size ||
                !ruleSetHistory.isSuccess ||
                activate.isPending
              }
              onClick={() => void confirmActivation()}
            >
              {activate.isPending
                ? t("activating")
                : t("activateSelectedAssessmentRules")}
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
          onReviewScope={() => {
            const target = inspectedRule;
            setInspectedRule(null);
            setScopeAuthRuleId(target);
          }}
        />
      ) : null}
      {importOpen && catalogId && rules.data ? (
        <AssessmentRuleImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          catalogId={catalogId}
          catalogRevision={rules.data.catalogRevision}
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
      {scopeAuthRuleId && catalogId && rules.data ? (
        <SelectedScopeAuthorizationDialog
          open={Boolean(scopeAuthRuleId)}
          onOpenChange={(open) => {
            if (!open) setScopeAuthRuleId(null);
          }}
          catalogId={catalogId}
          catalogRevision={rules.data.catalogRevision}
          ruleId={scopeAuthRuleId}
        />
      ) : null}
    </section>
  );
}
