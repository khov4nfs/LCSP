"use client";

import { useState } from "react";
import type { MessageKey } from "@lcsp/i18n";
import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  PREPARATION_CATALOG_COMPLETENESS,
  PREPARATION_CATALOG_KINDS,
  PREPARATION_CATALOG_REFERENCE_STATES,
  PREPARATION_CATALOG_SOURCES,
  LEGAL_REQUIREMENT_COVERAGE_STATES,
  type PreparationGeneratedCatalogRequest,
  type PreparationGeneratedCatalogEntry,
} from "@lcsp/contracts/compliance-rule-set";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { resolveAppMessage } from "@/lib/i18n";
import { getProblemCode } from "@/lib/api/problem-envelope";
import { usePreparationGeneratedCatalogQuery } from "@/lib/api/compliance-rule-set-queries";
import type { RuleSetPreparationRow } from "../../types/compliance-rule-sets.types";

const t = (key: string) => resolveAppMessage(key as MessageKey);
type CatalogEntry = PreparationGeneratedCatalogEntry;

/**
 * Business purpose: Present a paginated Admin catalog of persisted draft candidates or submitted canonical Rule Set entities.
 *
 * Business rules:
 * - The selected run's persisted inventory revision controls every request; Requirement and Assessment Rule collections remain separate and their server totals are authoritative.
 * - Draft associations are labeled as draft data, submitted links come from canonical identifiers, and unavailable or stale results are never represented as empty success.
 *
 * Execution flow:
 * 1. Select the catalog collection and search term for the current run.
 * 2. Fetch bounded server pages and render only the response's items and canonical counts.
 * 3. Open a bounded detail dialog from the selected persisted item and continue with the server cursor.
 *
 * Failure cases:
 * - Missing inventory revision disables reads; unavailable catalogs, stale cursors, and request failures have distinct visible states.
 *
 * Side effects:
 * - Read-only Admin query and local selection state; no Preparation or Rule Set lifecycle data is changed.
 */
export function PreparationGeneratedCatalog({
  run,
}: {
  run: RuleSetPreparationRow;
}) {
  const [kind, setKind] = useState<PreparationGeneratedCatalogRequest["kind"]>(
    PREPARATION_CATALOG_KINDS.REQUIREMENT,
  );
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CatalogEntry | null>(null);
  const query = usePreparationGeneratedCatalogQuery(
    run.preparationRunId,
    run.sourceAnalysisInventoryRevision ?? null,
    kind,
    search,
  );
  const firstPage = query.data?.pages[0];
  const entries: CatalogEntry[] = [];
  for (const page of query.data?.pages ?? []) {
    if (page.kind === kind) {
      entries.push(...(page.items as CatalogEntry[]));
    }
  }
  const stale =
    getProblemCode(query.error) ===
      COMPLIANCE_RULE_SET_ERROR_CODES.catalogCursorStale ||
    getProblemCode(query.error) ===
      COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunConflict;
  const entryAuthorityLabel =
    firstPage?.source === PREPARATION_CATALOG_SOURCES.DRAFT
      ? `${t("pages.complianceRuleSets.catalog.draftSource")} ${firstPage.draftVersion ?? ""}`
      : firstPage?.source === PREPARATION_CATALOG_SOURCES.SUBMITTED
        ? t("pages.complianceRuleSets.catalog.submittedSource")
        : null;

  return (
    <section
      className="flex flex-col gap-4 rounded-xl border border-border p-4"
      aria-labelledby="preparation-catalog-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="preparation-catalog-heading"
            className="text-lg font-semibold"
          >
            {t("pages.complianceRuleSets.catalog.title")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("pages.complianceRuleSets.catalog.description")}
          </p>
        </div>
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label={t("pages.complianceRuleSets.catalog.collectionLabel")}
        >
          <Button
            type="button"
            size="sm"
            variant={
              kind === PREPARATION_CATALOG_KINDS.REQUIREMENT
                ? "default"
                : "outline"
            }
            aria-pressed={kind === PREPARATION_CATALOG_KINDS.REQUIREMENT}
            onClick={() => {
              setSelected(null);
              setKind(PREPARATION_CATALOG_KINDS.REQUIREMENT);
            }}
          >
            {t("pages.complianceRuleSets.catalog.requirements")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={
              kind === PREPARATION_CATALOG_KINDS.ASSESSMENT_RULE
                ? "default"
                : "outline"
            }
            aria-pressed={kind === PREPARATION_CATALOG_KINDS.ASSESSMENT_RULE}
            onClick={() => {
              setSelected(null);
              setKind(PREPARATION_CATALOG_KINDS.ASSESSMENT_RULE);
            }}
          >
            {t("pages.complianceRuleSets.catalog.assessmentRules")}
          </Button>
        </div>
      </div>

      <label className="flex max-w-xl flex-col gap-1 text-sm font-medium">
        {t("pages.complianceRuleSets.catalog.search")}
        <Input
          value={search}
          onChange={(event) => {
            setSelected(null);
            setSearch(event.target.value);
          }}
          placeholder={t("pages.complianceRuleSets.catalog.searchPlaceholder")}
          maxLength={128}
        />
      </label>

      {run.sourceAnalysisInventoryRevision === null ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t("pages.complianceRuleSets.catalog.revisionUnavailable")}
        </p>
      ) : null}
      {query.isPending && run.sourceAnalysisInventoryRevision !== null ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t("pages.complianceRuleSets.catalog.loading")}
        </p>
      ) : null}
      {query.isError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>
              {stale
                ? t("pages.complianceRuleSets.catalog.stale")
                : t("pages.complianceRuleSets.catalog.loadFailed")}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void query.refreshFromFirstPage()}
            >
              {t("pages.complianceRuleSets.catalog.refresh")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {firstPage?.source === PREPARATION_CATALOG_SOURCES.UNAVAILABLE ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t("pages.complianceRuleSets.catalog.unavailable")}
        </p>
      ) : null}
      {firstPage &&
      firstPage.source !== PREPARATION_CATALOG_SOURCES.UNAVAILABLE ? (
        <div
          className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm"
          aria-live="polite"
        >
          <span>
            {t("pages.complianceRuleSets.catalog.total")}: {firstPage.total}
          </span>
          {firstPage.filteredTotal !== firstPage.total ? (
            <span>
              {t("pages.complianceRuleSets.catalog.matching")}:{" "}
              {firstPage.filteredTotal}
            </span>
          ) : null}
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
            {firstPage.source === PREPARATION_CATALOG_SOURCES.DRAFT
              ? `${t("pages.complianceRuleSets.catalog.draftSource")} ${firstPage.draftVersion ?? ""}`
              : t("pages.complianceRuleSets.catalog.submittedSource")}
          </span>
          {firstPage.completeness ===
          PREPARATION_CATALOG_COMPLETENESS.PARTIAL ? (
            <span className="text-muted-foreground">
              {t("pages.complianceRuleSets.catalog.partialDraft")}
            </span>
          ) : null}
        </div>
      ) : null}

      {entries.length === 0 &&
      firstPage?.source !== PREPARATION_CATALOG_SOURCES.UNAVAILABLE &&
      !query.isPending &&
      !query.isError ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t("pages.complianceRuleSets.catalog.empty")}
        </p>
      ) : null}
      {entries.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className="flex w-full flex-col items-start gap-1 p-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setSelected(entry)}
                aria-label={t("pages.complianceRuleSets.catalog.openItem")}
                aria-expanded={selected?.id === entry.id}
                aria-controls="preparation-catalog-entry-detail"
              >
                <span className="wrap-break-word font-medium">
                  {"title" in entry.data
                    ? entry.data.title
                    : entry.data.concept}
                </span>
                <span className="line-clamp-2 wrap-break-word text-sm text-muted-foreground">
                  {"proposition" in entry.data
                    ? entry.data.proposition
                    : entry.data.legalIntent}
                </span>
                {entryAuthorityLabel ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {entryAuthorityLabel}
                  </span>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  {entry.ordinal === null
                    ? t("pages.complianceRuleSets.catalog.draftEntry")
                    : `${t("pages.complianceRuleSets.catalog.ordinal")} ${entry.ordinal + 1}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {query.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage
            ? t("pages.complianceRuleSets.catalog.loadingMore")
            : t("pages.complianceRuleSets.catalog.loadMore")}
        </Button>
      ) : null}

      {selected ? (
        <CatalogEntryDetails
          entry={selected}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </section>
  );
}

/**
 * Business purpose: Show one bounded persisted catalog item without changing its draft or submitted status.
 *
 * Business rules:
 * - Display only fields already projected by the validated catalog contract; source references retain their draft-declared or submitted-verified state.
 * - The selected item is a bounded read-only detail view and never implies approval, assessability, or activation beyond persisted fields.
 *
 * Execution flow:
 * 1. Render the selected Requirement or Assessment Rule data and its direct identifiers.
 * 2. Render canonical coverage or requirement links for the applicable item kind.
 *
 * Failure cases:
 * - No selected item leaves the detail section unrendered.
 *
 * Side effects:
 * - Local selection display only; no API mutation or persistence change.
 */
function CatalogEntryDetails({
  entry,
  onClose,
}: {
  entry: CatalogEntry;
  onClose: () => void;
}) {
  const data = entry.data;
  const title = "title" in data ? data.title : data.concept;
  const summary = "proposition" in data ? data.proposition : data.legalIntent;
  const fields =
    "coverage" in data
      ? [
          [
            t("pages.complianceRuleSets.catalog.actorAndActions"),
            data.operativePropositions
              ?.map(
                (item) => `${item.actor} — ${item.modality}: ${item.action}`,
              )
              .join("\n") ?? "",
          ],
          [
            t("pages.complianceRuleSets.catalog.conditions"),
            data.applicabilityConditions.join("\n"),
          ],
          [
            t("pages.complianceRuleSets.catalog.qualifiers"),
            data.qualifiers.join("\n"),
          ],
          [
            t("pages.complianceRuleSets.catalog.exceptions"),
            data.exceptions.join("\n"),
          ],
          [
            t("pages.complianceRuleSets.catalog.coverage"),
            data.coverage.state ===
            LEGAL_REQUIREMENT_COVERAGE_STATES.NON_ASSESSABLE
              ? `${t("pages.complianceRuleSets.catalog.nonAssessable")}: ${data.coverage.nonAssessableReason ?? ""}`
              : t("pages.complianceRuleSets.catalog.coveredByRules"),
          ],
          [
            t("pages.complianceRuleSets.catalog.claimIds"),
            data.claimBindings.map((binding) => binding.claimId).join(", ") ||
              t("pages.complianceRuleSets.catalog.notRecorded"),
          ],
          [
            t("pages.complianceRuleSets.catalog.claimLinkAuthority"),
            data.claimBindingsState ===
            PREPARATION_CATALOG_REFERENCE_STATES.DRAFT_DECLARED
              ? t("pages.complianceRuleSets.catalog.draftClaimLinks")
              : data.claimBindingsState ===
                  PREPARATION_CATALOG_REFERENCE_STATES.SUBMITTED_VERIFIED
                ? t("pages.complianceRuleSets.catalog.verifiedClaimLinks")
                : t("pages.complianceRuleSets.catalog.notRecorded"),
          ],
        ]
      : [
          [
            t("pages.complianceRuleSets.catalog.applicability"),
            data.applicabilityGuidance,
          ],
          [
            t("pages.complianceRuleSets.catalog.requirementIds"),
            data.legalRequirementIds.join(", ") ||
              t("pages.complianceRuleSets.catalog.notRecorded"),
          ],
          [
            t("pages.complianceRuleSets.catalog.criteria"),
            data.criteria.map((criterion) => criterion.statement).join("\n"),
          ],
          [
            t("pages.complianceRuleSets.catalog.investigationGoals"),
            data.investigationGoals.join("\n"),
          ],
          [
            t("pages.complianceRuleSets.catalog.requiredEvidence"),
            data.requiredEvidence.join("\n"),
          ],
          [
            t("pages.complianceRuleSets.catalog.supportingEvidence"),
            data.supportingEvidence.join("\n"),
          ],
          [
            t("pages.complianceRuleSets.catalog.negativeEvidence"),
            data.negativeEvidence.join("\n"),
          ],
          [
            t("pages.complianceRuleSets.catalog.targetNodeTypes"),
            data.targetNodeTypes.join(", "),
          ],
          [
            t("pages.complianceRuleSets.catalog.keywords"),
            data.keywords.join(", "),
          ],
          [
            t("pages.complianceRuleSets.catalog.unresolvedConditions"),
            data.unresolvedConditions?.join("\n") ?? "",
          ],
        ];
  return (
    <section
      id="preparation-catalog-entry-detail"
      className="flex flex-col gap-4 rounded-lg border border-primary/30 bg-muted/30 p-4"
      aria-label={t("pages.complianceRuleSets.catalog.entryDetails")}
      aria-live="polite"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="wrap-break-word font-semibold">{title}</h3>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          {t("pages.complianceRuleSets.catalog.closeDetails")}
        </Button>
      </div>
      <p className="wrap-break-word whitespace-pre-wrap text-sm">{summary}</p>
      <dl className="grid gap-4 sm:grid-cols-2">
        {fields.map(([label, value]) => (
          <div key={label} className="space-y-1">
            <dt className="text-sm font-medium">{label}</dt>
            <dd className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
              {value || t("pages.complianceRuleSets.catalog.notRecorded")}
            </dd>
          </div>
        ))}
      </dl>
      <div className="space-y-1">
        <h3 className="text-sm font-medium">
          {t("pages.complianceRuleSets.catalog.sourceReferences")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {data.sourceReferencesState ===
          PREPARATION_CATALOG_REFERENCE_STATES.DRAFT_DECLARED
            ? t("pages.complianceRuleSets.catalog.draftReferences")
            : data.sourceReferencesState ===
                PREPARATION_CATALOG_REFERENCE_STATES.SUBMITTED_VERIFIED
              ? t("pages.complianceRuleSets.catalog.verifiedReferences")
              : t("pages.complianceRuleSets.catalog.notRecorded")}
        </p>
        <ul className="min-w-0 list-inside list-disc text-sm text-muted-foreground">
          {data.sourceReferences.map((reference, index) => (
            <li
              key={`${reference.documentId}:${reference.locator}:${index}`}
              className="wrap-break-word"
            >
              {reference.documentId} · {reference.locator}
            </li>
          ))}
        </ul>
      </div>
      <details className="rounded-md border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          {t("pages.complianceRuleSets.catalog.identifierDetails")}
        </summary>
        <p className="mt-2 break-all text-xs text-muted-foreground">
          <code>{entry.id}</code>
        </p>
      </details>
    </section>
  );
}
