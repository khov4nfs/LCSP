"use client";
import { ARTIFACT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import type { MessageKey } from "@lcsp/i18n";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveAppMessage } from "@/lib/i18n";
import { useComplianceRuleSetHistoryQuery } from "@/lib/api/compliance-rule-set-queries";
import { AdminPageHeader } from "../molecules/admin-page-header";
import { ComplianceRuleSetActiveCard } from "../molecules/compliance-rule-set-active-card";
import { RuleSetPreparationAction } from "../molecules/rule-set-preparation-action";
import { ComplianceRuleSetHistoryTable } from "./compliance-rule-set-history-table";
import { RuleSetPreparationList } from "./rule-set-preparation-list";

const t = (key: string) => resolveAppMessage(key as MessageKey);

/**
 * Compliance Rule Sets: an operations view of the shared rule set lifecycle
 * (Legal Source Version -> automatic Rule Set Preparation -> shared rule set version).
 * Explicit Admin preparation uses the same workflow as Legal Source activation.
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
  return (
    <div className="flex flex-col gap-6 pb-12">
      <AdminPageHeader
        title={t("pages.complianceRuleSets.title")}
        description={t("pages.complianceRuleSets.description")}
      />
      <ComplianceRuleSetActiveCard
        ruleSet={active}
        availability={history.data.preparation}
      />
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">
          {t("pages.complianceRuleSets.preparations")}
        </h2>
        <RuleSetPreparationList
          preparations={history.data.preparations}
          availability={history.data.preparation}
          ruleSets={history.data.ruleSets}
        />
        {!active ? (
          <RuleSetPreparationAction availability={history.data.preparation} />
        ) : null}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">
          {t("pages.complianceRuleSets.history")}
        </h2>
        <ComplianceRuleSetHistoryTable ruleSets={history.data.ruleSets} />
      </section>
    </div>
  );
}
