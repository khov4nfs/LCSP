import type { MessageKey } from "@lcsp/i18n";
import { RULE_SET_PREPARATION_SYSTEM_ACTOR } from "@lcsp/contracts/compliance-rule-set";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { resolveAppMessage } from "@/lib/i18n";
import { useRetryRuleSetPreparationMutation } from "@/lib/api/compliance-rule-set-queries";
import {
  canonicalExecutionLabel,
  formatLocaleTimestamp,
} from "@/features/workspace/utils/assessment-runtime-formatter";
import type { RuleSetPreparationListProps } from "../../types/compliance-rule-sets.types";

const t = (key: string) => resolveAppMessage(key as MessageKey);

/**
 * Automatic Rule Set Preparations, newest first. The only action is retrying a failed run of the
 * same Legal Source Version; nothing here can start a preparation for another source.
 */
export function RuleSetPreparationList({
  preparations,
}: RuleSetPreparationListProps) {
  const retry = useRetryRuleSetPreparationMutation();
  if (preparations.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        {t("pages.complianceRuleSets.emptyPreparations")}
      </p>
    );
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-border">
        {preparations.map((run) => (
          <li
            key={run.preparationRunId}
            className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3"
            data-preparation-state={run.executionState}
          >
            <div className="flex min-w-48 flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium">
                {run.legalSourceVersion}
              </span>
              <span className="text-xs text-muted-foreground">
                {t("pages.complianceRuleSets.attempt")} {run.attempt} ·{" "}
                {formatLocaleTimestamp(run.createdAt)} ·{" "}
                {run.requestedBy === RULE_SET_PREPARATION_SYSTEM_ACTOR
                  ? t("pages.complianceRuleSets.system")
                  : run.requestedBy}
              </span>
            </div>
            <div className="flex flex-col gap-0.5 text-sm">
              <span>{canonicalExecutionLabel(run.executionState)}</span>
              {run.failureReason ? (
                <span className="text-xs text-destructive">
                  {t(`pages.complianceRuleSets.failureReasons.${run.failureReason}`)}
                </span>
              ) : null}
            </div>
            {run.retryable ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={retry.isPending}
                onClick={() => retry.mutate(run.preparationRunId)}
              >
                {t(
                  retry.isPending
                    ? "pages.complianceRuleSets.retrying"
                    : "pages.complianceRuleSets.retry",
                )}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {retry.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {t("pages.complianceRuleSets.retryFailed")}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
