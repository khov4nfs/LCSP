"use client";
import { Suspense } from "react";
import { ARTIFACT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import type { MessageKey } from "@lcsp/i18n";
import {
  COLLECTION_METRIC_TONES,
  COLLECTION_METRIC_VARIANTS,
  CollectionMetricCard,
} from "@/components/molecules/collection-metric-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveAppMessage } from "@/lib/i18n";
import { useComplianceRuleSetHistoryQuery } from "@/lib/api/compliance-rule-set-queries";
import { AdminPageHeader } from "../molecules/admin-page-header";
import { ComplianceRuleSetActiveCard } from "../molecules/compliance-rule-set-active-card";
import { ComplianceRuleSetHistoryTable } from "./compliance-rule-set-history-table";
import { RuleSetPreparationList } from "./rule-set-preparation-list";
import { PendingRuleGroupings } from "./pending-rule-groupings";
import { LocalizationOperationsQueue } from "./localization-operations-queue";
import { LegalRuleCatalogWorkflow } from "./legal-rule-catalog-workflow";

const t = (key: string) => resolveAppMessage(key as MessageKey);

/**
 * Business purpose: Build selected Preparation Rule Sets within the existing Admin operations page.
 * Business rules:
 * - Chunking does not start preparation; LegalRule selection is explicit and customer artifacts retain their boundaries.
 * Execution flow:
 * 1. Load source/history context
 * 2. Present catalog selection and per-rule preparation
 * 3. Retain shared-set/history inspection.
 * Failure cases:
 * - Loading and API failures remain visible without fabricated run state.
 * Side effects:
 * - Read subscriptions; explicit mutations are owned by the workflow container.
 */
export function ComplianceRuleSetsPage() {
  const history = useComplianceRuleSetHistoryQuery();
  if (history.isPending) return <Skeleton className="h-72 w-full" />;
  if (history.isError)
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {t("pages.agenticAssessment.requestFailed")}{" "}
          <Button variant="outline" onClick={() => void history.refetch()}>
            {t("pages.agenticAssessment.retry")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  const active = history.data.ruleSets.find(
    (item) => item.lifecycleState === ARTIFACT_LIFECYCLE_STATES.ACTIVE,
  );
  const activeCount = history.data.ruleSets.filter(
    (item) => item.lifecycleState === ARTIFACT_LIFECYCLE_STATES.ACTIVE,
  ).length;
  const supersededCount = Math.max(0, history.data.ruleSets.length - activeCount);

  return (
    <div
      className="flex flex-col gap-6 pb-12"
      data-component="ComplianceRuleSetsPage"
    >
      <AdminPageHeader
        title={t("pages.complianceRuleSets.title")}
        description={t("pages.complianceRuleSets.description")}
      />
      <section
        aria-label={t("pages.complianceRuleSets.history")}
        className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"
      >
        <CollectionMetricCard
          variant={COLLECTION_METRIC_VARIANTS.spotlight}
          label={t("pages.complianceRuleSets.title")}
          value={history.data.ruleSets.length}
          context={t("pages.complianceRuleSets.history")}
          segments={[
            {
              key: "active",
              count: activeCount,
              toneClassName: "bg-bento-accent",
            },
            {
              key: "superseded",
              count: supersededCount,
              toneClassName: "bg-muted-foreground/50",
            },
          ]}
        />
        <CollectionMetricCard
          variant={COLLECTION_METRIC_VARIANTS.indicator}
          tone={COLLECTION_METRIC_TONES.success}
          label={t("pages.complianceRuleSets.states.ACTIVE")}
          value={active ? active.version : "—"}
          context={`${active?.assessmentRuleCount ?? 0} ${t("pages.complianceRuleSets.assessmentRules")}`}
        />
        <CollectionMetricCard
          variant={COLLECTION_METRIC_VARIANTS.indicator}
          tone={COLLECTION_METRIC_TONES.primary}
          label={t("pages.complianceRuleSets.requirements")}
          value={active?.legalRequirementCount ?? 0}
          context={history.data.preparation.legalSourceVersion ?? "—"}
        />
        <CollectionMetricCard
          variant={COLLECTION_METRIC_VARIANTS.indicator}
          tone={COLLECTION_METRIC_TONES.warning}
          label={t("pages.complianceRuleSets.preparations")}
          value={history.data.preparations.length}
          context={t("pages.complianceRuleSets.sourceVersion")}
        />
      </section>
      <Suspense fallback={<Skeleton className="h-72 w-full" />}>
        <LegalRuleCatalogWorkflow
          sourceId={history.data.preparation.legalSourceVersionId}
        />
      </Suspense>
      <ComplianceRuleSetActiveCard ruleSet={active} />
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">
          {t("pages.complianceRuleSets.preparations")}
        </h2>
        <RuleSetPreparationList
          preparations={history.data.preparations}
          availability={history.data.preparation}
          ruleSets={history.data.ruleSets}
        />
      </section>
      <PendingRuleGroupings />
      <LocalizationOperationsQueue />
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">
          {t("pages.complianceRuleSets.history")}
        </h2>
        <ComplianceRuleSetHistoryTable ruleSets={history.data.ruleSets} />
      </section>
    </div>
  );
}
