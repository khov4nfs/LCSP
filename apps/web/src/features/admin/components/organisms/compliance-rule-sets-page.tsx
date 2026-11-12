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
import { PREPARATION_ACTIVITY_SCOPES } from "@lcsp/contracts/compliance-rule-set";
import { RuleSetPreparationAction } from "../molecules/rule-set-preparation-action";
import { ComplianceRuleSetHistoryTable } from "./compliance-rule-set-history-table";
import { RuleSetPreparationList } from "./rule-set-preparation-list";
import { PendingRuleGroupings } from "./pending-rule-groupings";
import { LocalizationOperationsQueue } from "./localization-operations-queue";
import { canonicalExecutionLabel } from "@/features/workspace/utils/assessment-runtime-formatter";

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
      <section
        aria-labelledby="prepare-rule-set-heading"
        className="flex flex-col gap-3 rounded-lg border-l-4 border-primary bg-card p-4 shadow-sm sm:p-6"
        data-testid="rule-set-preparation-entry-point"
      >
        <div>
          <h2 id="prepare-rule-set-heading" className="text-lg font-semibold">
            {t("pages.complianceRuleSets.prepareSectionTitle")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("pages.complianceRuleSets.prepareSectionDescription")}
          </p>
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <div className="min-w-0">
            <dt className="text-muted-foreground">
              {t("pages.complianceRuleSets.preparationTargetSource")}
            </dt>
            <dd className="mt-1 break-all font-medium">
              {history.data.preparation.legalSourceVersion ??
                t("pages.complianceRuleSets.sourceNotSelected")}
            </dd>
            {history.data.preparation.legalSourceVersionId ? (
              <dd className="break-all font-mono text-xs text-muted-foreground">
                {history.data.preparation.legalSourceVersionId}
              </dd>
            ) : null}
            {history.data.preparation.legalSourceVersionId === null &&
            history.data.preparation.activeSourceCandidates.length > 0 ? (
              <dd className="mt-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("pages.complianceRuleSets.activeSourceCandidates")}
                </span>
                <ul className="mt-1 space-y-1">
                  {history.data.preparation.activeSourceCandidates.map(
                    (candidate) => (
                      <li
                        className="break-all text-xs"
                        key={candidate.legalSourceVersionId}
                      >
                        <span className="font-medium">{candidate.version}</span>
                        <span className="block font-mono text-muted-foreground">
                          {candidate.legalSourceVersionId}
                        </span>
                        <span className="text-muted-foreground">
                          {t(
                            candidate.sourceEvidenceComplete
                              ? "pages.complianceRuleSets.sourceEvidenceComplete"
                              : "pages.complianceRuleSets.sourceEvidenceIncomplete",
                          )}
                        </span>
                      </li>
                    ),
                  )}
                </ul>
              </dd>
            ) : null}
          </div>
          <div>
            <dt className="text-muted-foreground">
              {t("pages.complianceRuleSets.preparationScope")}
            </dt>
            <dd className="mt-1 font-medium">
              {t(
                `pages.complianceRuleSets.scopes.${PREPARATION_ACTIVITY_SCOPES[1]}`,
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {t("pages.complianceRuleSets.currentPreparation")}
            </dt>
            <dd className="mt-1 font-medium">
              {history.data.preparation.currentRun
                ? canonicalExecutionLabel(
                    history.data.preparation.currentRun.executionState,
                  )
                : t("pages.complianceRuleSets.noCurrentPreparation")}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {t("pages.complianceRuleSets.currentActiveRuleSet")}
            </dt>
            <dd className="mt-1 break-all font-medium">
              {history.data.preparation.activeRuleSetVersionId ??
                t("pages.complianceRuleSets.unavailable")}
            </dd>
          </div>
        </dl>
        <RuleSetPreparationAction
          availability={history.data.preparation}
          replaceActive={Boolean(
            history.data.preparation.activeRuleSetVersionId,
          )}
        />
      </section>
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
