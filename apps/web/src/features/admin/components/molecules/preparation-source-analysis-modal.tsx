"use client";

import { useRef, useState } from "react";
import type { ComponentProps, KeyboardEvent } from "react";
import type { MessageKey } from "@lcsp/i18n";
import {
  SOURCE_UNIT_DETAIL_AVAILABILITY,
  type PreparationSourceUnitsResponse,
} from "@lcsp/contracts/compliance-rule-set";
import { SOURCE_REVIEW_STATES } from "@lcsp/contracts/legal-source";
import { usePreparationSourceUnitDetailQuery } from "@/lib/api/compliance-rule-set-queries";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { resolveAppMessage } from "@/lib/i18n";
import { formatLocaleTimestamp } from "@/features/workspace/utils/assessment-runtime-formatter";
import { RuleSetPreparationActivity } from "./rule-set-preparation-activity";

const t = (key: string) => resolveAppMessage(key as MessageKey);
const SOURCE_ANALYSIS_TABS = [
  "overview",
  "provenance",
  "workerOutput",
  "technicalEvents",
] as const;
type SourceAnalysisTab = (typeof SOURCE_ANALYSIS_TABS)[number];

export type SourceAnalysisActivityProps = ComponentProps<
  typeof RuleSetPreparationActivity
>;

export type PreparationSourceAnalysisContext = {
  preparationRunId: string;
  legalSourceVersionId: string;
  inventoryRevision: number;
  materializationId: string;
  frontierRevision: number;
};
type PreparationSourceUnit = PreparationSourceUnitsResponse["units"][number];

type PreparationSourceAnalysisModalProps = {
  unit: PreparationSourceUnit | null;
  context: PreparationSourceAnalysisContext | null;
  activity: SourceAnalysisActivityProps;
  onOpenChange: (open: boolean) => void;
};

/**
 * Business purpose: Present one persisted Source Review unit and its bounded run-scoped evidence in the V3 modal.
 *
 * Business rules:
 * - Keep the selected sourceNodeId and pinned run/frontier identities visible without treating sibling nodes as one review unit.
 * - Show only the selected unit's persisted, contract-validated Source Review output and only canonical Requirement/Rule bindings proven through the pinned submitted semantic graph.
 * - Label technical activity as run-level because the event feed has no verified source-unit association.
 *
 * Execution flow:
 * 1. Query detail only for the selected run, inventory revision, and sourceNodeId; reset the active tab when the unit changes.
 * 2. Render persisted review detail, verified provenance, bounded structured output, or the existing run activity component.
 * 3. Use roving tab focus and arrow/Home/End navigation for keyboard access.
 *
 * Failure cases:
 * - Missing unit or pin context renders no modal content; loading, API failure, empty output, and unavailable mappings remain distinct.
 *
 * Side effects:
 * - One selected-unit read through the Admin BFF plus local modal/tab state; no source or Preparation state is written.
 */
export function PreparationSourceAnalysisModal({
  unit,
  context,
  activity,
  onOpenChange,
}: PreparationSourceAnalysisModalProps) {
  const [activeTab, setActiveTab] = useState<SourceAnalysisTab>(
    SOURCE_ANALYSIS_TABS[0],
  );
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const detail = usePreparationSourceUnitDetailQuery(
    context?.preparationRunId ?? null,
    context?.inventoryRevision ?? null,
    unit?.sourceNodeId ?? null,
  );

  if (!unit || !context) return null;

  const label = unit.title || unit.label || unit.structuralPath;
  const review = detail.data?.review;
  const output = detail.data?.output;
  const tabKeys: Record<SourceAnalysisTab, MessageKey> = {
    overview: "pages.complianceRuleSets.sourceAnalysis.tabs.overview",
    provenance: "pages.complianceRuleSets.sourceAnalysis.tabs.provenance",
    workerOutput: "pages.complianceRuleSets.sourceAnalysis.tabs.workerOutput",
    technicalEvents:
      "pages.complianceRuleSets.sourceAnalysis.tabs.technicalEvents",
  };

  function selectTabAt(index: number) {
    const boundedIndex =
      (index + SOURCE_ANALYSIS_TABS.length) % SOURCE_ANALYSIS_TABS.length;
    setActiveTab(SOURCE_ANALYSIS_TABS[boundedIndex]);
    tabRefs.current[boundedIndex]?.focus();
  }

  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      selectTabAt(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      selectTabAt(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectTabAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      selectTabAt(SOURCE_ANALYSIS_TABS.length - 1);
    }
  }

  return (
    <Dialog
      open={unit !== null}
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
    >
      <DialogContent
        className="max-h-dvh max-w-5xl p-0"
        closeLabel={t("pages.complianceRuleSets.sourceAnalysis.close")}
      >
        <DialogHeader className="shrink-0 flex-col gap-1">
          <DialogTitle className="pr-8 text-xl sm:text-2xl">
            {label}
          </DialogTitle>
          <DialogDescription className="break-all">
            {unit.structuralPath} · {unit.sourceNodeId}
          </DialogDescription>
        </DialogHeader>
        {detail.isPending ? (
          <p
            role="status"
            className="px-4 text-sm text-muted-foreground sm:px-6"
          >
            {t("pages.complianceRuleSets.sourceAnalysis.loading")}
          </p>
        ) : null}
        {detail.isError ? (
          <p role="alert" className="px-4 text-sm text-destructive sm:px-6">
            {t("pages.complianceRuleSets.sourceAnalysis.loadFailed")}
          </p>
        ) : null}
        <div className="shrink-0 overflow-x-auto border-b border-border px-3 sm:px-6">
          <div
            role="tablist"
            aria-label={t("pages.complianceRuleSets.sourceAnalysis.tabsLabel")}
            className="flex min-w-max gap-1"
          >
            {SOURCE_ANALYSIS_TABS.map((tab, index) => (
              <button
                key={tab}
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                id={`source-analysis-tab-${tab}`}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                aria-controls={`source-analysis-panel-${tab}`}
                tabIndex={activeTab === tab ? 0 : -1}
                onClick={() => setActiveTab(tab)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                className={`border-b-2 px-3 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring ${
                  activeTab === tab
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t(tabKeys[tab])}
              </button>
            ))}
          </div>
        </div>
        <div
          id={`source-analysis-panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`source-analysis-tab-${activeTab}`}
          tabIndex={0}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-5 outline-none sm:px-6"
        >
          {activeTab === "overview" ? (
            <div className="grid gap-5 md:grid-cols-2">
              <section className="space-y-3">
                <h3 className="font-semibold">
                  {t("pages.complianceRuleSets.sourceAnalysis.unitIdentity")}
                </h3>
                <dl className="grid gap-3 text-sm">
                  <Info
                    label={t(
                      "pages.complianceRuleSets.sourceAnalysis.nodeType",
                    )}
                    value={unit.nodeType}
                  />
                  <Info
                    label={t("pages.complianceRuleSets.sourceAnalysis.label")}
                    value={unit.label || unit.title}
                  />
                  <Info
                    label={t("pages.complianceRuleSets.sourceAnalysis.path")}
                    value={unit.structuralPath}
                  />
                  <Info
                    label={t(
                      "pages.complianceRuleSets.sourceAnalysis.documentId",
                    )}
                    value={unit.documentId}
                  />
                  <Info
                    label={t(
                      "pages.complianceRuleSets.sourceAnalysis.sourceNodeId",
                    )}
                    value={unit.sourceNodeId}
                  />
                </dl>
              </section>
              <section className="space-y-3">
                <h3 className="font-semibold">
                  {t("pages.complianceRuleSets.sourceAnalysis.reviewResult")}
                </h3>
                <dl className="grid gap-3 text-sm">
                  <Info
                    label={t(
                      "pages.complianceRuleSets.sourceAnalysis.reviewState",
                    )}
                    value={t(
                      `pages.complianceRuleSets.sourceAnalysis.reviewStates.${review?.state ?? unit.state}`,
                    )}
                  />
                  <Info
                    label={t(
                      "pages.complianceRuleSets.sourceAnalysis.disposition",
                    )}
                    value={
                      (review?.disposition ?? unit.disposition)
                        ? t(
                            `pages.complianceRuleSets.sourceAnalysis.dispositions.${review?.disposition ?? unit.disposition}`,
                          )
                        : t(
                            "pages.complianceRuleSets.sourceAnalysis.notRecorded",
                          )
                    }
                  />
                  <Info
                    label={t(
                      "pages.complianceRuleSets.sourceAnalysis.claimCount",
                    )}
                    value={String(review?.claimCount ?? unit.claimCount)}
                  />
                  <Info
                    label={t(
                      "pages.complianceRuleSets.sourceAnalysis.references",
                    )}
                    value={String(
                      review?.referenceCount ?? unit.referenceCount,
                    )}
                  />
                  <Info
                    label={t(
                      "pages.complianceRuleSets.sourceAnalysis.blockedReferences",
                    )}
                    value={String(
                      review?.blockedReferenceCount ??
                        unit.blockedReferenceCount,
                    )}
                  />
                  <Info
                    label={t(
                      "pages.complianceRuleSets.sourceAnalysis.completedAt",
                    )}
                    value={
                      (review?.completedAt ?? unit.completedAt)
                        ? formatLocaleTimestamp(
                            review?.completedAt ?? unit.completedAt!,
                          )
                        : t(
                            "pages.complianceRuleSets.sourceAnalysis.notRecorded",
                          )
                    }
                  />
                </dl>
                {review?.reason ? (
                  <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                    {review.reason}
                  </p>
                ) : null}
              </section>
              {detail.data?.review.referenceIds.length ? (
                <section className="space-y-2">
                  <h3 className="font-semibold">
                    {t("pages.complianceRuleSets.sourceAnalysis.references")}
                  </h3>
                  <ul className="flex flex-wrap gap-2">
                    {detail.data.review.referenceIds.map((referenceId) => (
                      <li key={referenceId}>
                        <code className="rounded bg-muted px-2 py-1 text-xs">
                          {referenceId}
                        </code>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {detail.data?.review.blockedReferenceIds.length ? (
                <section className="space-y-2">
                  <h3 className="font-semibold">
                    {t(
                      "pages.complianceRuleSets.sourceAnalysis.blockedReferences",
                    )}
                  </h3>
                  <ul className="flex flex-wrap gap-2">
                    {detail.data.review.blockedReferenceIds.map(
                      (referenceId) => (
                        <li key={referenceId}>
                          <code className="rounded bg-muted px-2 py-1 text-xs">
                            {referenceId}
                          </code>
                        </li>
                      ),
                    )}
                  </ul>
                </section>
              ) : null}
              <section className="space-y-3 md:col-span-2">
                <h3 className="font-semibold">
                  {t("pages.complianceRuleSets.sourceAnalysis.pinnedContext")}
                </h3>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <Info
                    label={t(
                      "pages.complianceRuleSets.sourceAnalysis.sourceVersion",
                    )}
                    value={context.legalSourceVersionId}
                  />
                  <Info
                    label={t(
                      "pages.complianceRuleSets.sourceAnalysis.materialization",
                    )}
                    value={context.materializationId}
                  />
                  <Info
                    label={t(
                      "pages.complianceRuleSets.sourceAnalysis.inventoryRevision",
                    )}
                    value={String(context.inventoryRevision)}
                  />
                  <Info
                    label={t(
                      "pages.complianceRuleSets.sourceAnalysis.frontierRevision",
                    )}
                    value={String(context.frontierRevision)}
                  />
                </dl>
              </section>
            </div>
          ) : null}
          {activeTab === "provenance" ? (
            <div className="space-y-5">
              <p className="text-sm text-muted-foreground">
                {t("pages.complianceRuleSets.sourceAnalysis.provenanceIntro")}
              </p>
              <section className="space-y-2">
                <h3 className="font-semibold">
                  {t("pages.complianceRuleSets.sourceAnalysis.ancestors")}
                </h3>
                {(detail.data?.ancestors ?? unit.ancestors).length > 0 ? (
                  <ol className="space-y-2">
                    {(detail.data?.ancestors ?? unit.ancestors).map(
                      (ancestor) => (
                        <li
                          key={ancestor.sourceNodeId}
                          className="rounded-md border border-border p-3 text-sm"
                        >
                          <span className="font-medium">
                            {ancestor.label || ancestor.title}
                          </span>
                          <span className="ml-2 text-muted-foreground">
                            {ancestor.structuralPath}
                          </span>
                          <code className="mt-1 block break-all text-xs text-muted-foreground">
                            {ancestor.sourceNodeId}
                          </code>
                        </li>
                      ),
                    )}
                  </ol>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("pages.complianceRuleSets.sourceAnalysis.noAncestors")}
                  </p>
                )}
              </section>
              <section className="space-y-2">
                <h3 className="font-semibold">
                  {t("pages.complianceRuleSets.sourceAnalysis.claimIds")}
                </h3>
                {(detail.data?.provenance.directClaimIds ?? unit.claimIds)
                  .length > 0 ? (
                  <ul className="flex flex-wrap gap-2">
                    {(
                      detail.data?.provenance.directClaimIds ?? unit.claimIds
                    ).map((claimId) => (
                      <li key={claimId}>
                        <code className="rounded bg-muted px-2 py-1 text-xs">
                          {claimId}
                        </code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("pages.complianceRuleSets.sourceAnalysis.noClaims")}
                  </p>
                )}
                {(review?.claimIdsTruncated ?? unit.claimIdsTruncated) ? (
                  <p className="text-xs text-muted-foreground">
                    {t(
                      "pages.complianceRuleSets.sourceAnalysis.claimIdsTruncated",
                    )}
                  </p>
                ) : null}
              </section>
              {detail.data?.provenance.requirementRuleMapping.availability ===
              SOURCE_UNIT_DETAIL_AVAILABILITY.AVAILABLE ? (
                <section className="space-y-2">
                  <h3 className="font-semibold">
                    {t(
                      "pages.complianceRuleSets.sourceAnalysis.persistedClaimIdentifiers",
                    )}
                  </h3>
                  {detail.data.provenance.requirementRuleMapping.associations
                    .length ? (
                    <ul className="space-y-2">
                      {detail.data.provenance.requirementRuleMapping.associations.map(
                        (association) => (
                          <li
                            key={`${association.claimId}:${association.legalRequirementId}`}
                            className="rounded-md border border-border p-3 text-sm"
                          >
                            <code className="block break-all">
                              {association.claimId} -&gt;{" "}
                              {association.legalRequirementId}
                            </code>
                            {association.assessmentRuleIds.map((ruleId) => (
                              <code
                                key={ruleId}
                                className="mt-1 block break-all text-muted-foreground"
                              >
                                {ruleId}
                              </code>
                            ))}
                          </li>
                        ),
                      )}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t("pages.complianceRuleSets.sourceAnalysis.noClaims")}
                    </p>
                  )}
                </section>
              ) : (
                <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                  {t(
                    "pages.complianceRuleSets.sourceAnalysis.relationshipsUnavailable",
                  )}
                </p>
              )}
            </div>
          ) : null}
          {activeTab === "workerOutput" ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("pages.complianceRuleSets.sourceAnalysis.workerOutputIntro")}
              </p>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <Info
                  label={t(
                    "pages.complianceRuleSets.sourceAnalysis.reviewState",
                  )}
                  value={t(
                    `pages.complianceRuleSets.sourceAnalysis.reviewStates.${review?.state ?? unit.state}`,
                  )}
                />
                <Info
                  label={t(
                    "pages.complianceRuleSets.sourceAnalysis.disposition",
                  )}
                  value={
                    (review?.disposition ?? unit.disposition)
                      ? t(
                          `pages.complianceRuleSets.sourceAnalysis.dispositions.${review?.disposition ?? unit.disposition}`,
                        )
                      : t("pages.complianceRuleSets.sourceAnalysis.notRecorded")
                  }
                />
              </dl>
              {output?.availability ===
              SOURCE_UNIT_DETAIL_AVAILABILITY.AVAILABLE ? (
                <section className="space-y-3">
                  <h3 className="font-semibold">
                    {t(
                      "pages.complianceRuleSets.sourceAnalysis.persistedClaimIdentifiers",
                    )}
                  </h3>
                  {output.claims.map((claim) => (
                    <article
                      key={claim.claimId}
                      className="space-y-2 rounded-md border border-border p-3"
                    >
                      <code className="break-all text-xs">{claim.claimId}</code>
                      <p className="text-xs text-muted-foreground">
                        {claim.claimType} Â· {claim.state}
                      </p>
                      <p className="whitespace-pre-wrap text-sm">
                        {claim.statement}
                      </p>
                      {claim.sourceNodeIds.length ? (
                        <p className="break-all text-xs text-muted-foreground">
                          {claim.sourceNodeIds.join(", ")}
                        </p>
                      ) : null}
                    </article>
                  ))}
                  {output.relations.map((relation) => (
                    <p
                      key={relation.relationId}
                      className="break-all text-xs text-muted-foreground"
                    >
                      {relation.kind}: {relation.fromClaimId} -&gt;{" "}
                      {relation.toClaimId}
                    </p>
                  ))}
                  {output.referenceAccounting.map((reference) => (
                    <p
                      key={reference.referenceId}
                      className="break-all text-xs text-muted-foreground"
                    >
                      {t("pages.complianceRuleSets.sourceAnalysis.references")}:{" "}
                      {reference.referenceId}
                    </p>
                  ))}
                  {Object.entries(output.identities).length ? (
                    <dl className="space-y-2">
                      {Object.entries(output.identities).map(
                        ([claimId, identity]) => (
                          <div
                            key={claimId}
                            className="rounded-md bg-muted p-3 text-xs"
                          >
                            <dt className="break-all font-medium">{claimId}</dt>
                            <dd className="mt-1 break-all text-muted-foreground">
                              {identity}
                            </dd>
                          </div>
                        ),
                      )}
                    </dl>
                  ) : null}
                </section>
              ) : output?.availability ===
                  SOURCE_UNIT_DETAIL_AVAILABILITY.EMPTY &&
                (review?.state ?? unit.state) ===
                  SOURCE_REVIEW_STATES.REVIEWED_NO_CLAIMS ? (
                <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                  {t("pages.complianceRuleSets.sourceAnalysis.noClaims")}
                </p>
              ) : (
                <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                  {t(
                    "pages.complianceRuleSets.sourceAnalysis.unitOutputUnavailable",
                  )}
                </p>
              )}
            </div>
          ) : null}
          {activeTab === "technicalEvents" ? (
            <div className="space-y-4">
              <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                {t(
                  "pages.complianceRuleSets.sourceAnalysis.runLevelEventsNotice",
                )}
              </p>
              <RuleSetPreparationActivity {...activity} />
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-medium">{label}</dt>
      <dd className="break-all text-muted-foreground">{value}</dd>
    </div>
  );
}
