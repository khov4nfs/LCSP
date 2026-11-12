"use client";
import { useAppLocale } from "@/components/providers/locale-provider";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { PreparationActivityProps } from "../../types/preparation-observability.types";
import type { MessageKey } from "@lcsp/i18n";
import { AGENT_EXECUTION_STATES } from "@lcsp/contracts/assessment";
import { ASSESSMENT_RUNTIME_RUN_STATUSES } from "@lcsp/contracts/evidence";
import { formatAppMessage, resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { WorkDisclosure } from "@/components/molecules/work-disclosure";
import {
  preparationTokenUsage,
  preparationUsageEvidence,
  preparationModelCalls,
  preparationProgress,
  projectPreparationActivity,
} from "../../utils/rule-set-preparation-activity";
import { PREPARATION_ACTIVITY_VISIBLE_LIMIT } from "../../config/preparation-activity.config";

export function RuleSetPreparationActivity({
  events,
  terminal,
  executionState,
  connected,
  directDraft = false,
  hasOlder = false,
  loadingOlder = false,
  historyError = false,
  historyLoading = false,
  onLoadOlder,
}: PreparationActivityProps) {
  useAppLocale();
  const [visibleCount, setVisibleCount] = useState(
    PREPARATION_ACTIVITY_VISIBLE_LIMIT,
  );
  const activities = projectPreparationActivity(
    events,
    terminal,
    executionState,
  );
  const usage = preparationTokenUsage(events);
  const usageEvidence = preparationUsageEvidence(events);
  const progress = preparationProgress(events);
  const visibleActivities = activities.slice(-visibleCount);
  const coverageRate =
    progress &&
    progress.reviewed !== null &&
    !progress.inconsistent &&
    progress.total > 0
      ? `${((progress.reviewed / progress.total) * 100).toFixed(1)}%`
      : null;
  const tokensPerUnit =
    progress &&
    !progress.inconsistent &&
    usageEvidence.total &&
    progress.reviewed !== null &&
    progress.reviewed > 0
      ? Math.round(usage.totalTokens / progress.reviewed)
      : null;
  const tokensPerClaim =
    progress &&
    !progress.inconsistent &&
    usageEvidence.total &&
    progress.persistedClaims &&
    progress.persistedClaims > 0
      ? Math.round(usage.totalTokens / progress.persistedClaims)
      : null;
  return (
    <section
      className="rounded-lg border border-border/70 bg-muted/20 p-4"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {resolveAppMessage("pages.complianceRuleSets.activity.title")}
        </h3>
        <span className="text-xs text-muted-foreground">
          {terminal
            ? resolveAppMessage(
                executionState === AGENT_EXECUTION_STATES.SUCCEEDED
                  ? "pages.complianceRuleSets.activity.terminalStatuses.SUCCEEDED"
                  : executionState === AGENT_EXECUTION_STATES.FAILED
                    ? "pages.complianceRuleSets.activity.terminalStatuses.FAILED"
                    : executionState === AGENT_EXECUTION_STATES.CANCELLED
                      ? "pages.complianceRuleSets.activity.terminalStatuses.CANCELLED"
                      : executionState === AGENT_EXECUTION_STATES.INTERRUPTED
                        ? "pages.complianceRuleSets.activity.terminalStatuses.INTERRUPTED"
                        : executionState === AGENT_EXECUTION_STATES.PAUSED
                          ? "pages.complianceRuleSets.activity.terminalStatuses.PAUSED"
                          : "pages.complianceRuleSets.activity.terminalStatuses.FINISHED",
              )
            : connected
              ? resolveAppMessage("pages.complianceRuleSets.activity.live")
              : resolveAppMessage(
                  "pages.complianceRuleSets.activity.reconnecting",
                )}
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {resolveAppMessage("pages.preparationOps.observedUsage")}
      </p>
      {historyError || historyLoading ? (
        <p role={historyError ? "alert" : "status"}>
          {resolveAppMessage(
            historyError
              ? "pages.preparationOps.historyError"
              : "pages.preparationOps.historyLoading",
          )}
        </p>
      ) : null}
      {progress?.partial ? (
        <p role="status">{resolveAppMessage("pages.preparationOps.partial")}</p>
      ) : null}
      {progress?.inconsistent ? (
        <p role="alert">
          {resolveAppMessage("pages.preparationOps.inconsistent")}
        </p>
      ) : null}
      {progress === null ? (
        <p>{resolveAppMessage("pages.preparationOps.notReported")}</p>
      ) : null}
      {progress ? (
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Detail
            labelKey="pages.complianceRuleSets.activity.sourceCoverage"
            value={`${progress.reviewed?.toLocaleString() ?? resolveAppMessage("pages.preparationOps.notReported")} / ${progress.total.toLocaleString()}${coverageRate ? ` (${coverageRate})` : ""}`}
          />
          <Detail
            labelKey="pages.complianceRuleSets.activity.sourceRemaining"
            value={
              progress.remaining !== null
                ? progress.remaining.toLocaleString()
                : null
            }
          />
          {!directDraft ? (
            <Detail
              labelKey="pages.complianceRuleSets.activity.reviewedWithClaims"
              value={progress.reviewedWithClaims?.toLocaleString() ?? null}
            />
          ) : null}
          {!directDraft ? (
            <Detail
              labelKey="pages.complianceRuleSets.activity.reviewedNoClaims"
              value={progress.reviewedNoClaims?.toLocaleString() ?? null}
            />
          ) : null}

          <Detail
            labelKey="pages.complianceRuleSets.activity.inReview"
            value={progress.inReview?.toLocaleString() ?? null}
          />
          <Detail
            labelKey="pages.complianceRuleSets.activity.pendingUnits"
            value={progress.pending?.toLocaleString() ?? null}
          />
          <Detail
            labelKey="pages.preparationOps.blockers"
            value={progress.blocked?.toLocaleString() ?? null}
          />
          {!directDraft ? (
            <Detail
              labelKey="pages.complianceRuleSets.activity.verifiedClaims"
              value={progress.persistedClaims?.toLocaleString() ?? null}
            />
          ) : null}
          {!directDraft ? (
            <Detail
              labelKey="pages.complianceRuleSets.activity.draftClaims"
              value={progress.claims?.toLocaleString() ?? null}
            />
          ) : null}
          <Detail
            labelKey="pages.complianceRuleSets.activity.tokenEfficiency"
            value={
              tokensPerUnit !== null
                ? formatAppMessage(
                    "pages.complianceRuleSets.activity.tokensPerUnitValue",
                    { count: tokensPerUnit.toLocaleString() },
                  )
                : null
            }
          />
          {!directDraft ? (
            <Detail
              labelKey="pages.complianceRuleSets.activity.tokensPerClaim"
              value={
                tokensPerClaim !== null
                  ? formatAppMessage(
                      "pages.complianceRuleSets.activity.tokensPerClaimValue",
                      { count: tokensPerClaim.toLocaleString() },
                    )
                  : null
              }
            />
          ) : null}
          <Detail
            labelKey="pages.complianceRuleSets.activity.requirements"
            value={progress.requirements?.toLocaleString() ?? null}
          />
          <Detail
            labelKey="pages.complianceRuleSets.activity.rules"
            value={progress.rules?.toLocaleString() ?? null}
          />
        </dl>
      ) : null}
      {activities.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {resolveAppMessage("pages.complianceRuleSets.activity.empty")}
        </p>
      ) : (
        <ol className="mt-3 flex flex-col gap-2">
          {visibleActivities.map((item) => (
            <li
              key={item.id}
              className="rounded-md border border-border/60 bg-background p-3"
            >
              <WorkDisclosure
                summary={
                  item.details.claimFile
                    ? formatAppMessage(item.labelKey, {
                        file: item.details.claimFile,
                      })
                    : resolveAppMessage(item.labelKey)
                }
                running={
                  !terminal &&
                  item.status === ASSESSMENT_RUNTIME_RUN_STATUSES.running
                }
                defaultExpanded={false}
                meta={
                  <span
                    className={cn(
                      "text-xs",
                      item.status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed &&
                        "text-destructive",
                      item.status ===
                        ASSESSMENT_RUNTIME_RUN_STATUSES.completed &&
                        "text-emerald-700 dark:text-emerald-400",
                    )}
                  >
                    {resolveAppMessage(
                      item.status === ASSESSMENT_RUNTIME_RUN_STATUSES.running
                        ? "pages.complianceRuleSets.activity.statuses.RUNNING"
                        : item.status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed
                          ? "pages.complianceRuleSets.activity.statuses.FAILED"
                          : item.status ===
                              ASSESSMENT_RUNTIME_RUN_STATUSES.completed
                            ? "pages.complianceRuleSets.activity.statuses.COMPLETED"
                            : item.status === "NOT_REPORTED"
                              ? "pages.preparationOps.notReported"
                              : item.status === AGENT_EXECUTION_STATES.PAUSED
                                ? "pages.complianceRuleSets.activity.statuses.PAUSED"
                                : "pages.complianceRuleSets.activity.statuses.CANCELLED",
                    )}
                    {item.details.provider || item.details.model
                      ? ` · ${[item.details.provider, item.details.model]
                          .filter(Boolean)
                          .join(" / ")}`
                      : null}
                  </span>
                }
                className="text-foreground"
              >
                <dl className="mt-2 grid gap-1 sm:grid-cols-2">
                  <Detail
                    labelKey="pages.complianceRuleSets.activity.claimFile"
                    value={item.details.claimFile}
                  />
                  <Detail
                    labelKey="pages.complianceRuleSets.activity.committedNodes"
                    value={item.details.committedNodes}
                  />
                  <Detail
                    labelKey="pages.complianceRuleSets.activity.rejectedNodes"
                    value={item.details.rejected}
                  />
                  <Detail
                    labelKey="pages.complianceRuleSets.activity.agent"
                    value={item.details.agent}
                  />
                  <Detail
                    labelKey="pages.complianceRuleSets.activity.subagent"
                    value={item.details.subagent}
                  />
                  <Detail
                    labelKey="pages.complianceRuleSets.activity.provider"
                    value={item.details.provider}
                  />
                  <Detail
                    labelKey="pages.complianceRuleSets.activity.model"
                    value={item.details.model}
                  />
                  <Detail
                    labelKey="pages.complianceRuleSets.activity.tool"
                    value={item.details.nativeTool}
                  />
                  <Detail
                    labelKey="pages.complianceRuleSets.activity.run"
                    value={item.details.runId}
                  />
                  <Detail
                    labelKey="pages.complianceRuleSets.activity.toolCall"
                    value={item.details.toolCallId}
                  />
                  <Detail
                    labelKey="pages.complianceRuleSets.activity.modelStep"
                    value={item.details.modelStepId}
                  />
                  <Detail
                    labelKey="pages.complianceRuleSets.activity.inputTokens"
                    value={item.details.inputTokens}
                  />
                  <Detail
                    labelKey="pages.complianceRuleSets.activity.outputTokens"
                    value={item.details.outputTokens}
                  />
                  <Detail
                    labelKey="pages.complianceRuleSets.activity.totalTokens"
                    value={item.details.totalTokens}
                  />
                  <Detail
                    labelKey="pages.complianceRuleSets.activity.sourcePath"
                    value={item.details.sourcePath}
                  />
                </dl>
              </WorkDisclosure>
            </li>
          ))}
        </ol>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <p>
          {resolveAppMessage("pages.preparationOps.visibleHistory")}:{" "}
          {visibleActivities.length} / {activities.length}
        </p>
        {activities.length > visibleCount ? (
          <Button
            type="button"
            onClick={() => setVisibleCount((current) => current + 100)}
          >
            {resolveAppMessage("pages.preparationOps.showEarlier")}
          </Button>
        ) : null}
        {hasOlder ? (
          <Button
            type="button"
            disabled={loadingOlder}
            onClick={() => {
              setVisibleCount((current) => current + 100);
              onLoadOlder?.();
            }}
          >
            {resolveAppMessage("pages.preparationOps.loadOlder")}
          </Button>
        ) : null}
        {historyError && onLoadOlder ? (
          <Button type="button" onClick={onLoadOlder}>
            {resolveAppMessage("pages.preparationOps.retryHistory")}
          </Button>
        ) : null}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {resolveAppMessage("pages.complianceRuleSets.activity.modelCalls")}:{" "}
        {preparationModelCalls(events).toLocaleString()}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {resolveAppMessage("pages.preparationOps.observedInput")}:{" "}
        {usageEvidence.input
          ? usage.inputTokens.toLocaleString()
          : resolveAppMessage("pages.preparationOps.notReported")}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {resolveAppMessage("pages.preparationOps.observedOutput")}:{" "}
        {usageEvidence.output
          ? usage.outputTokens.toLocaleString()
          : resolveAppMessage("pages.preparationOps.notReported")}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {resolveAppMessage("pages.complianceRuleSets.activity.tokenUsage")}:{" "}
        {usageEvidence.total
          ? usage.totalTokens.toLocaleString()
          : resolveAppMessage("pages.preparationOps.notReported")}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {resolveAppMessage("pages.complianceRuleSets.activity.historyScope")}
      </p>
    </section>
  );
}

function Detail({
  labelKey,
  value,
}: {
  labelKey: MessageKey;
  value: string | number | null;
}) {
  if (value === null || value === "") return null;
  return (
    <div>
      <dt className="font-medium">{resolveAppMessage(labelKey)}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}
