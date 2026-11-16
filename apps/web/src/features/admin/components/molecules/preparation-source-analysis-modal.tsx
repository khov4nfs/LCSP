"use client";

import { useRef, useState } from "react";
import type { ComponentProps, KeyboardEvent } from "react";
import type { MessageKey } from "@lcsp/i18n";
import {
  SOURCE_UNIT_DETAIL_AVAILABILITY,
  SOURCE_UNIT_DETAIL_MAPPING_REASONS,
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
import { Button } from "@/components/ui/button";
import { resolveAppMessage } from "@/lib/i18n";
import {
  canonicalExecutionLabel,
  formatLocaleTimestamp,
} from "@/features/workspace/utils/assessment-runtime-formatter";
import {
  preparationModelCalls,
  preparationTokenUsage,
  preparationUsageEvidence,
} from "../../utils/rule-set-preparation-activity";
import { RuleSetPreparationActivity } from "./rule-set-preparation-activity";
import {
  PreparationSourceContentReader,
  formatPreparationLegalSourceNodeLabel,
} from "./preparation-source-content-reader";

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
  frontierCoverage: PreparationSourceUnitsResponse["frontier"]["coverage"];
};
type PreparationSourceUnit = PreparationSourceUnitsResponse["units"][number];

type PreparationSourceAnalysisModalProps = {
  unit: PreparationSourceUnit | null;
  context: PreparationSourceAnalysisContext | null;
  activity: SourceAnalysisActivityProps;
  onOpenRunActivity: () => void;
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
  onOpenRunActivity,
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

  const label = formatPreparationLegalSourceNodeLabel(unit);
  const ancestors = detail.data?.ancestors ?? unit.ancestors;
  const hierarchy = [
    ...ancestors.map(formatPreparationLegalSourceNodeLabel),
    label,
  ]
    .filter(Boolean)
    .join(" › ");
  const review = detail.data?.review;
  const reviewState = review?.state ?? unit.state;
  const output = detail.data?.output;
  const directClaimCount = review?.claimCount ?? unit.claimCount;
  const directClaimIds =
    detail.data?.provenance.directClaimIds ?? unit.claimIds;
  const mapping = detail.data?.provenance.requirementRuleMapping;
  const mappingMessageKey =
    directClaimCount === 0
      ? "pages.complianceRuleSets.sourceAnalysis.mappingNoDirectClaims"
      : mapping?.availability === SOURCE_UNIT_DETAIL_AVAILABILITY.AVAILABLE
        ? mapping.associations.length > 0
          ? null
          : "pages.complianceRuleSets.sourceAnalysis.mappingNoVerifiedAssociations"
        : mapping?.unavailableReason ===
            SOURCE_UNIT_DETAIL_MAPPING_REASONS.RULE_SET_NOT_SUBMITTED
          ? "pages.complianceRuleSets.sourceAnalysis.mappingNoSubmittedRuleSet"
          : mapping?.unavailableReason ===
              SOURCE_UNIT_DETAIL_MAPPING_REASONS.PINNED_SEMANTIC_GRAPH_UNAVAILABLE
            ? "pages.complianceRuleSets.sourceAnalysis.mappingPinnedGraphUnavailable"
            : "pages.complianceRuleSets.sourceAnalysis.mappingUnavailable";
  const observedTokenUsage = preparationTokenUsage(activity.events);
  const usageEvidence = preparationUsageEvidence(activity.events);
  const observedModelCalls = preparationModelCalls(activity.events);
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
        if (!open) {
          setActiveTab(SOURCE_ANALYSIS_TABS[0]);
          onOpenChange(false);
        }
      }}
    >
      <DialogContent
        className="flex max-h-dvh max-w-5xl flex-col overflow-hidden p-0"
        closeLabel={t("pages.complianceRuleSets.sourceAnalysis.close")}
      >
        <DialogHeader className="shrink-0 flex-col gap-1">
          <DialogTitle className="wrap-break-word pr-8 text-xl sm:text-2xl">
            {label}
          </DialogTitle>
          <DialogDescription className="wrap-break-word">
            {hierarchy}
          </DialogDescription>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium">
              {t(
                `pages.complianceRuleSets.sourceAnalysis.reviewStates.${reviewState}`,
              )}
            </span>
            {(review?.disposition ?? unit.disposition) ? (
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                {t(
                  `pages.complianceRuleSets.sourceAnalysis.dispositions.${review?.disposition ?? unit.disposition}`,
                )}
              </span>
            ) : null}
          </div>
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
        {SOURCE_ANALYSIS_TABS.map((tab) => (
          <div
            key={tab}
            id={`source-analysis-panel-${tab}`}
            role="tabpanel"
            aria-labelledby={`source-analysis-tab-${tab}`}
            tabIndex={activeTab === tab ? 0 : -1}
            hidden={activeTab !== tab}
            className="min-h-0 flex-1 overflow-y-auto px-4 py-5 outline-none sm:px-6"
          >
            {activeTab === tab ? (
              <div className="min-h-0">
                {activeTab === "overview" ? (
                  <div className="space-y-5">
                    <section className="space-y-4 rounded-lg border-l-4 border-primary bg-primary/5 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h3 className="font-semibold">
                          {t(
                            "pages.complianceRuleSets.sourceAnalysis.reviewResult",
                          )}
                        </h3>
                        <span className="rounded-full border border-primary/30 bg-background px-2.5 py-1 text-xs font-medium">
                          {t(
                            `pages.complianceRuleSets.sourceAnalysis.reviewStates.${reviewState}`,
                          )}
                        </span>
                      </div>
                      {reviewState ===
                      SOURCE_REVIEW_STATES.REVIEWED_NO_CLAIMS ? (
                        <p className="wrap-break-word text-sm">
                          {t(
                            "pages.complianceRuleSets.sourceAnalysis.noClaimsOutcome",
                          )}
                        </p>
                      ) : null}
                      <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
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
                      {reviewState ===
                      SOURCE_REVIEW_STATES.REVIEWED_NO_CLAIMS ? (
                        <div className="space-y-1 rounded-md bg-background/70 p-3 text-sm">
                          <p className="font-medium">
                            {t(
                              "pages.complianceRuleSets.sourceAnalysis.reviewReason",
                            )}
                          </p>
                          <p className="wrap-break-word text-muted-foreground">
                            {review?.reason ||
                              t(
                                "pages.complianceRuleSets.sourceAnalysis.notRecorded",
                              )}
                          </p>
                          {review?.reasonTruncated ? (
                            <p className="text-xs text-muted-foreground">
                              {t(
                                "pages.complianceRuleSets.sourceAnalysis.reasonTruncated",
                              )}
                            </p>
                          ) : null}
                        </div>
                      ) : review?.reason ? (
                        <div className="space-y-1 rounded-md bg-background/70 p-3 text-sm text-muted-foreground">
                          <p className="wrap-break-word">
                            <span className="font-medium text-foreground">
                              {t(
                                "pages.complianceRuleSets.sourceAnalysis.reviewReason",
                              )}
                              :{" "}
                            </span>
                            {review.reason}
                          </p>
                          {review.reasonTruncated ? (
                            <p className="text-xs">
                              {t(
                                "pages.complianceRuleSets.sourceAnalysis.reasonTruncated",
                              )}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </section>

                    <section className="space-y-2">
                      <h3 className="font-semibold">
                        {t(
                          "pages.complianceRuleSets.sourceAnalysis.unitIdentity",
                        )}
                      </h3>
                      <p className="wrap-break-word text-sm">{hierarchy}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatPreparationLegalSourceNodeLabel({
                          nodeType: unit.nodeType,
                          label: "",
                          title: "",
                        })}
                      </p>
                    </section>

                    {review &&
                    (review.referenceIds.length > 0 ||
                      review.blockedReferenceIds.length > 0 ||
                      review.referenceIdsTruncated ||
                      review.blockedReferenceIdsTruncated) ? (
                      <details className="rounded-lg border border-border p-3">
                        <summary className="cursor-pointer text-sm font-medium">
                          {t(
                            "pages.complianceRuleSets.sourceAnalysis.referenceDetails",
                          )}
                        </summary>
                        <div className="space-y-3 pt-3">
                          {review.referenceIds.length ? (
                            <ReferenceList
                              label={t(
                                "pages.complianceRuleSets.sourceAnalysis.references",
                              )}
                              values={review.referenceIds}
                            />
                          ) : null}
                          {review.blockedReferenceIds.length ? (
                            <ReferenceList
                              label={t(
                                "pages.complianceRuleSets.sourceAnalysis.blockedReferences",
                              )}
                              values={review.blockedReferenceIds}
                            />
                          ) : null}
                          {review.referenceIdsTruncated ||
                          review.blockedReferenceIdsTruncated ? (
                            <p className="text-xs text-muted-foreground">
                              {t(
                                "pages.complianceRuleSets.sourceAnalysis.referencesTruncated",
                              )}
                            </p>
                          ) : null}
                        </div>
                      </details>
                    ) : null}

                    <details className="rounded-lg border border-border p-3">
                      <summary className="cursor-pointer text-sm font-medium">
                        {t(
                          "pages.complianceRuleSets.sourceAnalysis.technicalIdentity",
                        )}
                      </summary>
                      <dl className="grid min-w-0 gap-3 pt-3 text-sm sm:grid-cols-2">
                        <TechnicalIdentifier
                          label={t(
                            "pages.complianceRuleSets.sourceAnalysis.sourceNodeId",
                          )}
                          value={unit.sourceNodeId}
                        />
                        <TechnicalIdentifier
                          label={t(
                            "pages.complianceRuleSets.sourceAnalysis.documentId",
                          )}
                          value={unit.documentId}
                        />
                        <TechnicalIdentifier
                          label={t(
                            "pages.complianceRuleSets.sourceAnalysis.sourceVersion",
                          )}
                          value={context.legalSourceVersionId}
                        />
                        <TechnicalIdentifier
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
                        <div className="min-w-0 sm:col-span-2">
                          <dt className="text-muted-foreground">
                            {t("pages.complianceRuleSets.sourceAnalysis.path")}
                          </dt>
                          <dd className="wrap-break-word">
                            <code>{unit.structuralPath}</code>
                          </dd>
                        </div>
                      </dl>
                    </details>
                  </div>
                ) : null}
                {activeTab === "provenance" ? (
                  <div className="space-y-5">
                    <p className="text-sm text-muted-foreground">
                      {t(
                        "pages.complianceRuleSets.sourceAnalysis.provenanceIntro",
                      )}
                    </p>
                    <section className="space-y-2">
                      <h3 className="font-semibold">
                        {t("pages.complianceRuleSets.sourceAnalysis.ancestors")}
                      </h3>
                      {ancestors.length > 0 ? (
                        <ol className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                          {ancestors.map((ancestor, index) => (
                            <li
                              key={ancestor.sourceNodeId}
                              className="flex min-w-0 items-center gap-2"
                            >
                              {index > 0 ? (
                                <span
                                  aria-hidden="true"
                                  className="text-muted-foreground"
                                >
                                  ›
                                </span>
                              ) : null}
                              <span className="wrap-break-word font-medium">
                                {formatPreparationLegalSourceNodeLabel(
                                  ancestor,
                                )}
                              </span>
                            </li>
                          ))}
                          <li className="flex min-w-0 items-center gap-2">
                            <span
                              aria-hidden="true"
                              className="text-muted-foreground"
                            >
                              ›
                            </span>
                            <span className="wrap-break-word font-semibold">
                              {label}
                            </span>
                          </li>
                        </ol>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {t(
                            "pages.complianceRuleSets.sourceAnalysis.noAncestors",
                          )}
                        </p>
                      )}
                      <details className="rounded-lg border border-border p-3">
                        <summary className="cursor-pointer text-sm font-medium">
                          {t(
                            "pages.complianceRuleSets.sourceAnalysis.technicalIdentity",
                          )}
                        </summary>
                        <ul className="grid min-w-0 gap-3 pt-3 sm:grid-cols-2">
                          {ancestors.map((ancestor) => (
                            <li
                              key={ancestor.sourceNodeId}
                              className="min-w-0 rounded-md bg-muted/50 p-3"
                            >
                              <p className="wrap-break-word text-sm font-medium">
                                {formatPreparationLegalSourceNodeLabel(
                                  ancestor,
                                )}
                              </p>
                              <p className="wrap-break-word text-xs text-muted-foreground">
                                <code>{ancestor.structuralPath}</code>
                              </p>
                              <p className="break-all text-xs text-muted-foreground">
                                <code>{ancestor.sourceNodeId}</code>
                              </p>
                            </li>
                          ))}
                          <li className="min-w-0 rounded-md bg-muted/50 p-3">
                            <p className="wrap-break-word text-sm font-medium">
                              {label}
                            </p>
                            <p className="wrap-break-word text-xs text-muted-foreground">
                              <code>{unit.structuralPath}</code>
                            </p>
                            <p className="break-all text-xs text-muted-foreground">
                              <code>{unit.sourceNodeId}</code>
                            </p>
                          </li>
                        </ul>
                      </details>
                    </section>
                    <PreparationSourceContentReader
                      key={`${context.preparationRunId}:${context.inventoryRevision}:${unit.sourceNodeId}`}
                      preparationRunId={context.preparationRunId}
                      inventoryRevision={context.inventoryRevision}
                      unit={unit}
                      ancestors={ancestors}
                    />
                    <section className="space-y-2">
                      <h3 className="font-semibold">
                        {t("pages.complianceRuleSets.sourceAnalysis.claimIds")}
                      </h3>
                      {directClaimIds.length > 0 ? (
                        <details className="rounded-lg border border-border p-3">
                          <summary className="cursor-pointer text-sm font-medium">
                            {t(
                              "pages.complianceRuleSets.sourceAnalysis.claimIdsCount",
                            ).replace("{count}", String(directClaimIds.length))}
                          </summary>
                          <ul className="grid min-w-0 gap-2 pt-3 sm:grid-cols-2">
                            {directClaimIds.map((claimId) => (
                              <li
                                key={claimId}
                                className="min-w-0 break-all rounded bg-muted px-2 py-1 text-xs"
                              >
                                <code>{claimId}</code>
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : directClaimCount === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          {t(
                            "pages.complianceRuleSets.sourceAnalysis.noClaims",
                          )}
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {t(
                            "pages.complianceRuleSets.sourceAnalysis.claimIdsUnavailable",
                          )}
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
                    {detail.data?.provenance.requirementRuleMapping
                      .availability ===
                    SOURCE_UNIT_DETAIL_AVAILABILITY.AVAILABLE ? (
                      <section className="space-y-2">
                        <h3 className="font-semibold">
                          {t(
                            "pages.complianceRuleSets.sourceAnalysis.requirementRuleLinks",
                          )}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {t(
                            "pages.complianceRuleSets.sourceAnalysis.submittedVerifiedMapping",
                          )}
                        </p>
                        {detail.data.provenance.requirementRuleMapping
                          .associations.length ? (
                          <ul className="space-y-2">
                            {detail.data.provenance.requirementRuleMapping.associations.map(
                              (association) => (
                                <li
                                  key={`${association.claimId}:${association.legalRequirementId}`}
                                  className="rounded-md border border-border p-3 text-sm"
                                >
                                  <dl className="grid min-w-0 gap-3 sm:grid-cols-3">
                                    <IdentifierValue
                                      label={t(
                                        "pages.complianceRuleSets.sourceAnalysis.claimIds",
                                      )}
                                      value={association.claimId}
                                    />
                                    <IdentifierValue
                                      label={t(
                                        "pages.complianceRuleSets.catalog.requirements",
                                      )}
                                      value={association.legalRequirementId}
                                    />
                                    <div className="min-w-0">
                                      <dt className="font-medium">
                                        {t(
                                          "pages.complianceRuleSets.catalog.assessmentRules",
                                        )}
                                      </dt>
                                      <dd className="mt-1 space-y-1">
                                        {association.assessmentRuleIds.length >
                                        0 ? (
                                          association.assessmentRuleIds.map(
                                            (ruleId) => (
                                              <code
                                                key={ruleId}
                                                className="block break-all text-xs text-muted-foreground"
                                              >
                                                {ruleId}
                                              </code>
                                            ),
                                          )
                                        ) : (
                                          <span className="text-xs text-muted-foreground">
                                            {t(
                                              "pages.complianceRuleSets.sourceAnalysis.noAssessmentRulesLinked",
                                            )}
                                          </span>
                                        )}
                                      </dd>
                                    </div>
                                  </dl>
                                </li>
                              ),
                            )}
                          </ul>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            {t(
                              mappingMessageKey ??
                                "pages.complianceRuleSets.sourceAnalysis.mappingNoVerifiedAssociations",
                            )}
                          </p>
                        )}
                      </section>
                    ) : (
                      <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                        {t(
                          mappingMessageKey ??
                            "pages.complianceRuleSets.sourceAnalysis.mappingUnavailable",
                        )}
                      </p>
                    )}
                    {mapping?.associationsTruncated ? (
                      <p className="text-xs text-muted-foreground">
                        {t(
                          "pages.complianceRuleSets.sourceAnalysis.outputTruncated",
                        )}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {activeTab === "workerOutput" ? (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      {t(
                        "pages.complianceRuleSets.sourceAnalysis.workerOutputIntro",
                      )}
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
                            : t(
                                "pages.complianceRuleSets.sourceAnalysis.notRecorded",
                              )
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
                            <p className="wrap-break-word whitespace-pre-wrap text-base font-medium">
                              {claim.statement}
                            </p>
                            <dl className="grid gap-2 text-xs sm:grid-cols-2">
                              <Info
                                label={t(
                                  "pages.complianceRuleSets.sourceAnalysis.claimType",
                                )}
                                value={claim.claimType}
                              />
                              <Info
                                label={t(
                                  "pages.complianceRuleSets.sourceAnalysis.claimState",
                                )}
                                value={claim.state}
                              />
                            </dl>{" "}
                            {claim.sourceNodeIds.length ? (
                              <section className="space-y-1">
                                <h4 className="text-xs font-medium">
                                  {t(
                                    "pages.complianceRuleSets.sourceAnalysis.supportingSources",
                                  )}
                                </h4>
                                <ul className="flex min-w-0 flex-wrap gap-2">
                                  {claim.sourceNodeIds.map((sourceNodeId) => (
                                    <li
                                      key={sourceNodeId}
                                      className="min-w-0 break-all rounded bg-muted px-2 py-1 text-xs"
                                    >
                                      <code>{sourceNodeId}</code>
                                    </li>
                                  ))}
                                </ul>
                              </section>
                            ) : null}
                            {claim.sourceNodeIdsTruncated ||
                            claim.sourceSupportTruncated ? (
                              <p className="text-xs text-muted-foreground">
                                {t(
                                  "pages.complianceRuleSets.sourceAnalysis.outputTruncated",
                                )}
                              </p>
                            ) : null}
                            <details className="rounded-md bg-muted/50 p-3">
                              <summary className="cursor-pointer text-xs font-medium">
                                {t(
                                  "pages.complianceRuleSets.sourceAnalysis.technicalClaimDetails",
                                )}
                              </summary>
                              <div className="space-y-2 pt-2 text-xs">
                                <p className="break-all">
                                  <span className="font-medium">
                                    {t(
                                      "pages.complianceRuleSets.sourceAnalysis.claimIds",
                                    )}
                                    :{" "}
                                  </span>
                                  <code>{claim.claimId}</code>
                                </p>
                                {claim.semanticAuthority ||
                                claim.assessability ? (
                                  <p className="wrap-break-word">
                                    {claim.semanticAuthority
                                      ? t(
                                          "pages.complianceRuleSets.sourceAnalysis.semanticAuthority",
                                        ) +
                                        ": " +
                                        claim.semanticAuthority
                                      : null}
                                    {claim.assessability
                                      ? " · " +
                                        t(
                                          "pages.complianceRuleSets.sourceAnalysis.assessability",
                                        ) +
                                        ": " +
                                        claim.assessability
                                      : null}
                                  </p>
                                ) : null}
                                {claim.nonOperativeReason ? (
                                  <p className="wrap-break-word">
                                    {claim.nonOperativeReason}
                                  </p>
                                ) : null}
                                {claim.sourceSupport.map((support) => (
                                  <p
                                    key={
                                      support.nodeId + ":" + support.startOffset
                                    }
                                    className="wrap-break-word"
                                  >
                                    <code>
                                      {support.nodeId} · {support.startOffset}–
                                      {support.endOffset} ·{" "}
                                      {support.contentSha256}
                                    </code>
                                  </p>
                                ))}
                              </div>
                            </details>
                          </article>
                        ))}
                        {output.relations.map((relation) => (
                          <div
                            key={relation.relationId}
                            className="min-w-0 rounded-md bg-muted/50 p-3 text-xs"
                          >
                            <p className="wrap-break-word">
                              <span className="font-medium">
                                {t(
                                  "pages.complianceRuleSets.sourceAnalysis.relationKind",
                                )}
                                :{" "}
                              </span>
                              {relation.kind}
                            </p>
                            <p className="break-all">
                              <span className="font-medium">
                                {t(
                                  "pages.complianceRuleSets.sourceAnalysis.fromClaim",
                                )}
                                :{" "}
                              </span>
                              <code>{relation.fromClaimId}</code>
                            </p>
                            <p className="break-all">
                              <span className="font-medium">
                                {t(
                                  "pages.complianceRuleSets.sourceAnalysis.toClaim",
                                )}
                                :{" "}
                              </span>
                              <code>{relation.toClaimId}</code>
                            </p>
                          </div>
                        ))}
                        {output.referenceAccounting.map((reference) => (
                          <div
                            key={reference.referenceId}
                            className="min-w-0 rounded-md bg-muted/50 p-3 text-xs"
                          >
                            <p className="break-all">
                              <span className="font-medium">
                                {t(
                                  "pages.complianceRuleSets.sourceAnalysis.references",
                                )}
                                :{" "}
                              </span>
                              <code>{reference.referenceId}</code>
                            </p>
                            <p>
                              {reference.material
                                ? t(
                                    "pages.complianceRuleSets.sourceAnalysis.materialReference",
                                  )
                                : t(
                                    "pages.complianceRuleSets.sourceAnalysis.nonMaterialReference",
                                  )}
                            </p>
                            {reference.nonMaterialReason ? (
                              <p className="wrap-break-word">
                                {reference.nonMaterialReason}
                              </p>
                            ) : null}
                            {reference.relationIds.length ? (
                              <details className="pt-1">
                                <summary className="cursor-pointer font-medium">
                                  {t(
                                    "pages.complianceRuleSets.sourceAnalysis.relationIds",
                                  )}
                                </summary>
                                <p className="wrap-break-word pt-1">
                                  <code>
                                    {reference.relationIds.join(", ")}
                                  </code>
                                </p>
                              </details>
                            ) : null}
                          </div>
                        ))}
                        {Object.entries(output.identities).length ? (
                          <dl className="space-y-2">
                            {Object.entries(output.identities).map(
                              ([claimId, identity]) => (
                                <div
                                  key={claimId}
                                  className="rounded-md bg-muted p-3 text-xs"
                                >
                                  <dt className="break-all font-medium">
                                    {claimId}
                                  </dt>
                                  <dd className="mt-1 break-all text-muted-foreground">
                                    {identity}
                                  </dd>
                                </div>
                              ),
                            )}
                          </dl>
                        ) : null}
                        {output.claimsTruncated ||
                        output.identitiesTruncated ||
                        output.relationsTruncated ||
                        output.referenceAccountingTruncated ? (
                          <p className="rounded bg-muted p-2 text-xs text-muted-foreground">
                            {t(
                              "pages.complianceRuleSets.sourceAnalysis.outputTruncated",
                            )}
                          </p>
                        ) : null}
                      </section>
                    ) : output?.availability ===
                      SOURCE_UNIT_DETAIL_AVAILABILITY.EMPTY ? (
                      <div className="space-y-2 rounded-md bg-muted p-3 text-sm">
                        <p className="font-medium">
                          {reviewState ===
                          SOURCE_REVIEW_STATES.REVIEWED_NO_CLAIMS
                            ? t(
                                "pages.complianceRuleSets.sourceAnalysis.noClaimsOutcome",
                              )
                            : t(
                                "pages.complianceRuleSets.sourceAnalysis.emptyStructuredOutput",
                              )}
                        </p>
                        {review?.reason ? (
                          <p className="wrap-break-word text-muted-foreground">
                            <span className="font-medium">
                              {t(
                                "pages.complianceRuleSets.sourceAnalysis.reviewReason",
                              )}
                              :{" "}
                            </span>
                            {review.reason}
                          </p>
                        ) : reviewState ===
                          SOURCE_REVIEW_STATES.REVIEWED_NO_CLAIMS ? (
                          <p className="text-muted-foreground">
                            {t(
                              "pages.complianceRuleSets.sourceAnalysis.notRecorded",
                            )}
                          </p>
                        ) : null}
                      </div>
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
                    <section className="space-y-4 rounded-lg border border-border p-4">
                      <h3 className="font-semibold">
                        {t(
                          "pages.complianceRuleSets.sourceAnalysis.runActivitySummary",
                        )}
                      </h3>
                      <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
                        <TechnicalIdentifier
                          label={t(
                            "pages.complianceRuleSets.sourceAnalysis.preparationRunId",
                          )}
                          value={context.preparationRunId}
                        />
                        <Info
                          label={t(
                            "pages.complianceRuleSets.sourceAnalysis.runStatus",
                          )}
                          value={
                            activity.executionState
                              ? canonicalExecutionLabel(activity.executionState)
                              : t(
                                  "pages.complianceRuleSets.sourceAnalysis.notRecorded",
                                )
                          }
                        />
                        <Info
                          label={t(
                            "pages.complianceRuleSets.sourceAnalysis.total",
                          )}
                          value={String(context.frontierCoverage.total)}
                        />
                        <Info
                          label={t(
                            "pages.complianceRuleSets.sourceAnalysis.pending",
                          )}
                          value={String(context.frontierCoverage.pending)}
                        />
                        <Info
                          label={t(
                            "pages.complianceRuleSets.sourceAnalysis.inReview",
                          )}
                          value={String(context.frontierCoverage.inReview)}
                        />
                        <Info
                          label={t(
                            "pages.complianceRuleSets.sourceAnalysis.reviewedWithClaims",
                          )}
                          value={String(
                            context.frontierCoverage.reviewedWithClaims,
                          )}
                        />
                        <Info
                          label={t(
                            "pages.complianceRuleSets.sourceAnalysis.reviewedNoClaims",
                          )}
                          value={String(
                            context.frontierCoverage.reviewedNoClaims,
                          )}
                        />
                        <Info
                          label={t(
                            "pages.complianceRuleSets.sourceAnalysis.blockedReferences",
                          )}
                          value={String(
                            context.frontierCoverage.blockedReferences,
                          )}
                        />
                        <Info
                          label={t(
                            "pages.complianceRuleSets.sourceAnalysis.observedModelCalls",
                          )}
                          value={observedModelCalls.toLocaleString()}
                        />
                        <Info
                          label={t(
                            "pages.complianceRuleSets.sourceAnalysis.observedTokenUsage",
                          )}
                          value={
                            usageEvidence.total
                              ? observedTokenUsage.totalTokens.toLocaleString()
                              : t(
                                  "pages.complianceRuleSets.sourceAnalysis.notReported",
                                )
                          }
                        />
                      </dl>
                      <p className="text-xs text-muted-foreground">
                        {t(
                          "pages.complianceRuleSets.sourceAnalysis.activityHistoryMayBeIncomplete",
                        )}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          onOpenChange(false);
                          onOpenRunActivity();
                        }}
                      >
                        {t(
                          "pages.complianceRuleSets.sourceAnalysis.openRunActivity",
                        )}
                      </Button>
                    </section>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-medium">{label}</dt>
      <dd className="wrap-break-word text-muted-foreground">{value}</dd>
    </div>
  );
}

function IdentifierValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-medium">{label}</dt>
      <dd className="mt-1 break-all text-xs text-muted-foreground">
        <code>{value}</code>
      </dd>
    </div>
  );
}

function TechnicalIdentifier({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copyIdentifier() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 flex min-w-0 flex-wrap items-start gap-2">
        <code className="min-w-0 flex-1 break-all text-xs">{value}</code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={t(
            "pages.complianceRuleSets.sourceAnalysis.copyIdentifier",
          )}
          onClick={() => void copyIdentifier()}
        >
          {t(
            copied
              ? "pages.complianceRuleSets.sourceAnalysis.identifierCopied"
              : "pages.complianceRuleSets.sourceAnalysis.copyIdentifier",
          )}
        </Button>
      </dd>
      {copied ? (
        <span className="sr-only" role="status" aria-live="polite">
          {t("pages.complianceRuleSets.sourceAnalysis.identifierCopied")}
        </span>
      ) : null}
    </div>
  );
}

function ReferenceList({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="min-w-0 space-y-2">
      <h4 className="text-sm font-medium">{label}</h4>
      <ul className="grid min-w-0 gap-2 sm:grid-cols-2">
        {values.map((value) => (
          <li
            key={value}
            className="min-w-0 break-all rounded bg-muted px-2 py-1 text-xs"
          >
            <code>{value}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}
