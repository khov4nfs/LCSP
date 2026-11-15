"use client";

import { useEffect, useMemo, useState } from "react";
import type { MessageKey } from "@lcsp/i18n";
import {
  SOURCE_REVIEW_STATES,
  type SourceReviewState,
} from "@lcsp/contracts/legal-source";
import type { PreparationSourceUnitsResponse } from "@lcsp/contracts/compliance-rule-set";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppLocale } from "@/components/providers/locale-provider";
import { resolveAppMessage } from "@/lib/i18n";
import { usePreparationSourceUnitsQuery } from "@/lib/api/compliance-rule-set-queries";
import type { RuleSetPreparationRow } from "../../types/compliance-rule-sets.types";
import {
  PreparationSourceAnalysisModal,
  type PreparationSourceAnalysisContext,
  type SourceAnalysisActivityProps,
} from "../molecules/preparation-source-analysis-modal";

const t = (key: string) => resolveAppMessage(key as MessageKey);
type PreparationSourceUnit = PreparationSourceUnitsResponse["units"][number];

type PreparationSourceAnalysisExplorerProps = {
  run: RuleSetPreparationRow;
  activity: SourceAnalysisActivityProps;
  onOpenRunActivity: () => void;
};

type SourceAnalysisUnitGroup = {
  key: string;
  title: string;
  units: PreparationSourceUnit[];
};

/**
 * Business purpose: Group source review rows under persisted document hierarchy for visual navigation.
 *
 * Business rules:
 * - Group by document and persisted top ancestor only; never combine, replace, or reinterpret unit identities or review states.
 * - Preserve input ordering within each hierarchy group.
 *
 * Execution flow:
 * 1. Resolve each row's persisted document title and first ancestor.
 * 2. Append the original row to its hierarchy group in received order.
 *
 * Failure cases:
 * - Missing document titles use a localized neutral label; missing ancestors use a neutral hierarchy label without exposing IDs as headings.
 *
 * Side effects:
 * - Pure presentation projection; no coverage or source-review state is recalculated.
 */
export function groupPreparationSourceUnits(
  units: PreparationSourceUnit[],
  documents: Array<{ documentId: string; title: string }>,
): SourceAnalysisUnitGroup[] {
  const grouped = new Map<string, SourceAnalysisUnitGroup>();
  for (const unit of units) {
    const root = unit.ancestors[0];
    const document = documents.find(
      (item) => item.documentId === unit.documentId,
    );
    const key = `${unit.documentId}:${root?.sourceNodeId ?? unit.documentId}`;
    const title = [
      document?.title ||
        t("pages.complianceRuleSets.sourceAnalysis.sourceDocumentFallback"),
      root?.label ||
        root?.title ||
        t("pages.complianceRuleSets.sourceAnalysis.documentGroup"),
    ].join(" · ");
    const group = grouped.get(key);
    if (group) group.units.push(unit);
    else grouped.set(key, { key, title, units: [unit] });
  }
  return [...grouped.values()];
}

/**
 * Business purpose: Let an Admin explore the canonical, paginated Source Review units for one selected Preparation run.
 *
 * Business rules:
 * - Use only the run's persisted inventory revision and server-returned frontier coverage.
 * - Keep each sourceNodeId independently selectable; hierarchy groups are visual headings and never merge review state.
 * - Send search, document, and review-state filters to the server and continue only with server cursors.
 *
 * Execution flow:
 * 1. Debounce the search term and register a query keyed by run, revision, and filters.
 * 2. Render canonical coverage and grouped page units, preserving each unit's identity and status.
 * 3. Open the selected unit in the four-tab modal; clear selection when the modal closes or the list refreshes.
 *
 * Failure cases:
 * - Missing revision, loading, empty, upstream error, and continuation failure have distinct states; failed pagination offers a first-page refresh.
 *
 * Side effects:
 * - Read-only Admin BFF requests and local filter/modal state; no source review or Preparation state is changed.
 */
export function PreparationSourceAnalysisExplorer({
  run,
  activity,
  onOpenRunActivity,
}: PreparationSourceAnalysisExplorerProps) {
  useAppLocale();
  const [state, setState] = useState<SourceReviewState | undefined>();
  const [documentId, setDocumentId] = useState<string | undefined>();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selectedUnit, setSelectedUnit] =
    useState<PreparationSourceUnit | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  const query = usePreparationSourceUnitsQuery(
    run.preparationRunId,
    run.sourceAnalysisInventoryRevision ?? null,
    { state, documentId, search: search || undefined },
  );
  const pages = query.data?.pages ?? [];
  const firstPage = pages[0];
  const units = pages.flatMap((page) => page.units);
  const revisionUnavailable =
    run.sourceAnalysisInventoryRevision === null ||
    run.sourceAnalysisInventoryRevision === undefined;
  const documents = useMemo(
    () => run.draft?.sourceDocuments ?? [],
    [run.draft?.sourceDocuments],
  );
  const groups = useMemo(
    () => groupPreparationSourceUnits(units, documents),
    [units, documents],
  );

  const context: PreparationSourceAnalysisContext | null =
    selectedUnit && firstPage
      ? {
          preparationRunId: firstPage.preparationRunId,
          legalSourceVersionId: firstPage.legalSourceVersionId,
          inventoryRevision: firstPage.inventoryRevision,
          materializationId: firstPage.materializationId,
          frontierRevision: firstPage.frontier.revision,
          frontierCoverage: firstPage.frontier.coverage,
        }
      : null;

  function refreshFromFirstPage() {
    setSelectedUnit(null);
    void query.refreshFromFirstPage();
  }

  return (
    <section
      aria-labelledby="source-analysis-title"
      className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-6"
    >
      <header className="space-y-1">
        <h2 id="source-analysis-title" className="text-lg font-semibold">
          {t("pages.complianceRuleSets.sourceAnalysis.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("pages.complianceRuleSets.sourceAnalysis.description")}
        </p>
      </header>

      {revisionUnavailable ? (
        <p role="status" className="rounded-md bg-muted p-3 text-sm">
          {t("pages.complianceRuleSets.sourceAnalysis.revisionUnavailable")}
        </p>
      ) : null}

      {firstPage ? (
        <section
          aria-label={t("pages.complianceRuleSets.sourceAnalysis.coverage")}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          <Coverage
            label={t("pages.complianceRuleSets.sourceAnalysis.total")}
            value={firstPage.frontier.coverage.total}
          />
          <Coverage
            label={t("pages.complianceRuleSets.sourceAnalysis.pending")}
            value={firstPage.frontier.coverage.pending}
          />
          <Coverage
            label={t("pages.complianceRuleSets.sourceAnalysis.inReview")}
            value={firstPage.frontier.coverage.inReview}
          />
          <Coverage
            label={t(
              "pages.complianceRuleSets.sourceAnalysis.reviewedWithClaims",
            )}
            value={firstPage.frontier.coverage.reviewedWithClaims}
          />
          <Coverage
            label={t(
              "pages.complianceRuleSets.sourceAnalysis.reviewedNoClaims",
            )}
            value={firstPage.frontier.coverage.reviewedNoClaims}
          />
          <Coverage
            label={t(
              "pages.complianceRuleSets.sourceAnalysis.blockedReferences",
            )}
            value={firstPage.frontier.coverage.blockedReferences}
          />
          <Coverage
            label={t("pages.complianceRuleSets.sourceAnalysis.persistedClaims")}
            value={firstPage.frontier.coverage.persistedClaims}
          />
        </section>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <label className="grid gap-1 text-sm" htmlFor="source-analysis-search">
          <span>{t("pages.complianceRuleSets.sourceAnalysis.search")}</span>
          <Input
            id="source-analysis-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t(
              "pages.complianceRuleSets.sourceAnalysis.searchPlaceholder",
            )}
            maxLength={128}
          />
        </label>
        <label className="grid gap-1 text-sm" htmlFor="source-analysis-state">
          <span>
            {t("pages.complianceRuleSets.sourceAnalysis.stateFilter")}
          </span>
          <select
            id="source-analysis-state"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={state ?? ""}
            onChange={(event) =>
              setState(
                event.target.value
                  ? (event.target.value as SourceReviewState)
                  : undefined,
              )
            }
          >
            <option value="">
              {t("pages.complianceRuleSets.sourceAnalysis.allStates")}
            </option>
            {Object.values(SOURCE_REVIEW_STATES).map((value) => (
              <option key={value} value={value}>
                {t(
                  `pages.complianceRuleSets.sourceAnalysis.reviewStates.${value}`,
                )}
              </option>
            ))}
          </select>
        </label>
        <label
          className="grid gap-1 text-sm"
          htmlFor="source-analysis-document"
        >
          <span>
            {t("pages.complianceRuleSets.sourceAnalysis.documentFilter")}
          </span>
          <select
            id="source-analysis-document"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={documentId ?? ""}
            onChange={(event) => setDocumentId(event.target.value || undefined)}
          >
            <option value="">
              {t("pages.complianceRuleSets.sourceAnalysis.allDocuments")}
            </option>
            {documents.map((document) => (
              <option key={document.documentId} value={document.documentId}>
                {document.title || document.documentId}
              </option>
            ))}
          </select>
        </label>
      </div>

      {query.isPending && !revisionUnavailable ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("pages.complianceRuleSets.sourceAnalysis.loading")}
        </p>
      ) : null}
      {query.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-destructive">
            {t("pages.complianceRuleSets.sourceAnalysis.loadFailed")}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={refreshFromFirstPage}
          >
            {t("pages.complianceRuleSets.sourceAnalysis.refresh")}
          </Button>
        </div>
      ) : null}
      {query.isFetchNextPageError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-md bg-muted p-3"
        >
          <p className="text-sm">
            {t("pages.complianceRuleSets.sourceAnalysis.pageChanged")}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={refreshFromFirstPage}
          >
            {t("pages.complianceRuleSets.sourceAnalysis.refresh")}
          </Button>
        </div>
      ) : null}
      {firstPage && units.length === 0 && !query.isFetching ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("pages.complianceRuleSets.sourceAnalysis.noUnits")}
        </p>
      ) : null}

      <div className="space-y-4">
        {groups.map((group) => (
          <section key={group.key} className="space-y-2">
            <h3 className="border-b border-border pb-2 text-sm font-semibold">
              {group.title}
            </h3>
            <ul className="divide-y divide-border">
              {group.units.map((unit) => (
                <li key={unit.sourceNodeId} className="py-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <h4 className="wrap-break-word font-medium">
                        {unit.title || unit.label || unit.structuralPath}
                      </h4>
                      <p className="wrap-break-word text-xs text-muted-foreground">
                        <span className="font-medium">
                          {t(
                            "pages.complianceRuleSets.sourceAnalysis.nodeType",
                          )}
                          :{" "}
                        </span>
                        <code>{unit.nodeType}</code> · {unit.structuralPath}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t(
                          "pages.complianceRuleSets.sourceAnalysis.claimCount",
                        )}
                        : {unit.claimCount}
                        {" · "}
                        {t(
                          "pages.complianceRuleSets.sourceAnalysis.blockedReferences",
                        )}
                        : {unit.blockedReferenceCount}
                        {unit.disposition
                          ? ` · ${t(`pages.complianceRuleSets.sourceAnalysis.dispositions.${unit.disposition}`)}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium">
                        {t(
                          `pages.complianceRuleSets.sourceAnalysis.reviewStates.${unit.state}`,
                        )}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedUnit(unit)}
                      >
                        {t(
                          "pages.complianceRuleSets.sourceAnalysis.viewDetails",
                        )}
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {query.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t(
            query.isFetchingNextPage
              ? "pages.complianceRuleSets.sourceAnalysis.loadingMore"
              : "pages.complianceRuleSets.sourceAnalysis.loadMore",
          )}
        </Button>
      ) : null}

      <PreparationSourceAnalysisModal
        key={selectedUnit?.sourceNodeId ?? "no-selected-unit"}
        unit={selectedUnit}
        context={context}
        activity={activity}
        onOpenRunActivity={onOpenRunActivity}
        onOpenChange={(open) => {
          if (!open) setSelectedUnit(null);
        }}
      />
    </section>
  );
}

function Coverage({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums">
        {value.toLocaleString()}
      </dd>
    </div>
  );
}
