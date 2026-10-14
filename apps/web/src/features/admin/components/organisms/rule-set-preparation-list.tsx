import type { MessageKey } from "@lcsp/i18n";
import Link from "next/link";
import { AGENT_EXECUTION_STATES } from "@lcsp/contracts/assessment";
import { useState } from "react";
import { RULE_SET_PREPARATION_SYSTEM_ACTOR } from "@lcsp/contracts/compliance-rule-set";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { resolveAppMessage } from "@/lib/i18n";
import {
  useCancelRuleSetPreparationMutation,
  useRetryRuleSetPreparationMutation,
} from "@/lib/api/compliance-rule-set-queries";
import {
  canonicalExecutionLabel,
  formatLocaleTimestamp,
} from "@/features/workspace/utils/assessment-runtime-formatter";
import type { RuleSetPreparationListProps } from "../../types/compliance-rule-sets.types";
import { useRuleSetPreparationActivity } from "../../hooks/use-rule-set-preparation-activity";
import { RuleSetPreparationActivity } from "../molecules/rule-set-preparation-activity";

const t = (key: string) => resolveAppMessage(key as MessageKey);

/**
 * Rule Set Preparation history, newest first, with run-scoped retry/cancel actions.
 */
export function RuleSetPreparationList({
  preparations,
  availability,
  ruleSets,
}: RuleSetPreparationListProps) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(
    preparations[0]?.preparationRunId ?? null,
  );
  const activeRunId = preparations.some(
    (run) => run.preparationRunId === selectedRunId,
  )
    ? selectedRunId
    : (preparations[0]?.preparationRunId ?? null);
  const retry = useRetryRuleSetPreparationMutation();
  const cancel = useCancelRuleSetPreparationMutation();
  const [confirmRunId, setConfirmRunId] = useState<string | null>(null);
  const selectedRun = preparations.find(
    (run) => run.preparationRunId === activeRunId,
  );
  const terminal =
    selectedRun !== undefined &&
    selectedRun.executionState !== AGENT_EXECUTION_STATES.RUNNING &&
    selectedRun.executionState !== AGENT_EXECUTION_STATES.QUEUED;
  const activity = useRuleSetPreparationActivity(activeRunId, terminal);
  const activeRuleSet = ruleSets.find(
    (ruleSet) =>
      ruleSet.ruleSetVersionId === availability.activeRuleSetVersionId,
  );
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
            {run.retryable &&
            run.executionState === AGENT_EXECUTION_STATES.FAILED ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={retry.isPending || cancel.isPending}
                onClick={() => retry.mutate(run.preparationRunId)}
              >
                {t(
                  retry.isPending
                    ? "pages.complianceRuleSets.retrying"
                    : "pages.complianceRuleSets.retry",
                )}
              </Button>
            ) : null}
            {run.executionState === AGENT_EXECUTION_STATES.QUEUED ||
            run.executionState === AGENT_EXECUTION_STATES.RUNNING ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={cancel.isPending || retry.isPending}
                aria-busy={
                  cancel.isPending && cancel.variables === run.preparationRunId
                }
                onClick={() => setConfirmRunId(run.preparationRunId)}
              >
                {t(
                  cancel.isPending && cancel.variables === run.preparationRunId
                    ? "pages.complianceRuleSets.cancelling"
                    : "pages.complianceRuleSets.cancelPreparation",
                )}
              </Button>
            ) : null}
            {run.executionState === AGENT_EXECUTION_STATES.QUEUED ||
            run.executionState === AGENT_EXECUTION_STATES.RUNNING ? (
              activeRuleSet ? (
                <p className="w-full text-xs text-muted-foreground">
                  {t("pages.complianceRuleSets.replacingActiveVersion")}{" "}
                  <span className="font-medium">{activeRuleSet.version}</span>.{" "}
                  {t("pages.complianceRuleSets.activeVersionRemainsInUse")}
                </p>
              ) : null
            ) : run.retryable && activeRuleSet ? (
              <p className="w-full text-xs text-muted-foreground">
                {t("pages.complianceRuleSets.activeVersionRemainsInUse")}
              </p>
            ) : null}
            {run.executionState === AGENT_EXECUTION_STATES.SUCCEEDED &&
            run.ruleSetVersionId ? (
              <Link
                className="text-sm font-medium text-primary underline underline-offset-4"
                href={`/admin/compliance-rule-sets/${run.ruleSetVersionId}`}
              >
                {t("pages.complianceRuleSets.viewResult")}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
      {activeRunId ? (
        <RuleSetPreparationActivity
          events={activity.events}
          connected={activity.connected}
          terminal={terminal}
          executionState={selectedRun?.executionState ?? null}
        />
      ) : null}
      {retry.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {t("pages.complianceRuleSets.retryFailed")}
          </AlertDescription>
        </Alert>
      ) : null}
      {cancel.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {t("pages.complianceRuleSets.cancelFailed")}
          </AlertDescription>
        </Alert>
      ) : null}
      <Dialog
        open={confirmRunId !== null}
        onOpenChange={(open) => {
          if (!open && !cancel.isPending) setConfirmRunId(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader className="flex-col">
            <DialogTitle>
              {t("pages.complianceRuleSets.confirmCancelTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("pages.complianceRuleSets.confirmCancelDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row justify-end pt-5">
            <Button
              variant="outline"
              disabled={cancel.isPending}
              onClick={() => setConfirmRunId(null)}
            >
              {t("pages.complianceRuleSets.keepRunning")}
            </Button>
            <Button
              variant="destructive"
              disabled={cancel.isPending || confirmRunId === null}
              onClick={() => {
                if (confirmRunId === null) return;
                const runId = confirmRunId;
                setConfirmRunId(null);
                cancel.mutate(runId);
              }}
            >
              {t(
                cancel.isPending
                  ? "pages.complianceRuleSets.cancelling"
                  : "pages.complianceRuleSets.confirmCancel",
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
