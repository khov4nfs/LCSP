import type { MessageKey } from "@lcsp/i18n";
import { AGENT_EXECUTION_STATES } from "@lcsp/contracts/assessment";
import { useState } from "react";
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
import { useRuleSetPreparationActivity } from "../../hooks/use-rule-set-preparation-activity";
import { RuleSetPreparationActivity } from "../molecules/rule-set-preparation-activity";

const t = (key: string) => resolveAppMessage(key as MessageKey);

/**
 * Automatic Rule Set Preparations, newest first. The only action is retrying a failed run of the
 * same Legal Source Version; nothing here can start a preparation for another source.
 */
export function RuleSetPreparationList({
  preparations,
}: RuleSetPreparationListProps) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(
    preparations[0]?.preparationRunId ?? null,
  );
  const activeRunId = preparations.some(
    (run) => run.preparationRunId === selectedRunId,
  )
    ? selectedRunId
    : (preparations[0]?.preparationRunId ?? null);
  const activity = useRuleSetPreparationActivity(activeRunId);
  const retry = useRetryRuleSetPreparationMutation();
  const selectedRun = preparations.find(
    (run) => run.preparationRunId === activeRunId,
  );
  const terminal =
    selectedRun !== undefined &&
    selectedRun.executionState !== AGENT_EXECUTION_STATES.RUNNING &&
    selectedRun.executionState !== AGENT_EXECUTION_STATES.QUEUED;
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
            <button
              type="button"
              className="flex min-w-48 flex-1 flex-col items-start gap-0.5 text-left"
              aria-pressed={activeRunId === run.preparationRunId}
              onClick={() => setSelectedRunId(run.preparationRunId)}
            >
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
            </button>
            <div className="flex flex-col gap-0.5 text-sm">
              <span>{canonicalExecutionLabel(run.executionState)}</span>
              {run.failureReason ? (
                <span className="text-xs text-destructive">
                  {t(
                    `pages.complianceRuleSets.failureReasons.${run.failureReason}`,
                  )}
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
      {activeRunId ? (
        <RuleSetPreparationActivity
          events={activity.events}
          connected={activity.connected}
          terminal={terminal}
        />
      ) : null}
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
