"use client";
import { useAppLocale } from "@/components/providers/locale-provider";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { PreparationActivityProps } from "../../types/preparation-observability.types";
import type { MessageKey } from "@lcsp/i18n";
import { AGENT_EXECUTION_STATES } from "@lcsp/contracts/assessment";
import { ASSESSMENT_RUNTIME_RUN_STATUSES } from "@lcsp/contracts/evidence";
import { PREPARATION_STAGE_OBSERVATIONS } from "@lcsp/contracts/compliance-rule-set";
import { formatAppMessage, resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { WorkDisclosure } from "@/components/molecules/work-disclosure";
import {
  type PreparationActivity,
  preparationTokenUsage,
  preparationUsageEvidence,
  preparationModelCalls,
  preparationCanonicalProgress,
  preparationProgress,
  projectPreparationActivity,
} from "../../utils/rule-set-preparation-activity";
import { PREPARATION_ACTIVITY_VISIBLE_LIMIT } from "../../config/preparation-activity.config";

const ACTIVITY_FILTERS = {
  ALL: "ALL",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  OTHER: "OTHER",
} as const;
type ActivityFilter = (typeof ACTIVITY_FILTERS)[keyof typeof ACTIVITY_FILTERS];
const ACTIVITY_FILTER_ORDER = Object.values(ACTIVITY_FILTERS);

/**
 * Business purpose: Filter the loaded Preparation activity rows by their recorded operation status.
 *
 * Business rules:
 * - Filters affect only visible event rows; canonical run coverage and loaded-history usage totals remain independent.
 * - Running, completed, and failed are exact shared status values; every other recorded or unreported status belongs to Other.
 *
 * Execution flow:
 * 1. Accept all rows for the All filter.
 * 2. Match explicit status filters against shared runtime constants.
 * 3. Return remaining statuses only for the Other filter.
 *
 * Failure cases:
 * - Unknown status values remain visible under Other rather than being discarded.
 *
 * Side effects:
 * - None: pure presentation filtering over already loaded events.
 */
function activityMatchesFilter(
  item: PreparationActivity,
  filter: ActivityFilter,
) {
  if (filter === ACTIVITY_FILTERS.ALL) return true;
  if (filter === ACTIVITY_FILTERS.RUNNING)
    return item.status === ASSESSMENT_RUNTIME_RUN_STATUSES.running;
  if (filter === ACTIVITY_FILTERS.COMPLETED)
    return item.status === ASSESSMENT_RUNTIME_RUN_STATUSES.completed;
  if (filter === ACTIVITY_FILTERS.FAILED)
    return item.status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed;
  return (
    item.status !== ASSESSMENT_RUNTIME_RUN_STATUSES.running &&
    item.status !== ASSESSMENT_RUNTIME_RUN_STATUSES.completed &&
    item.status !== ASSESSMENT_RUNTIME_RUN_STATUSES.failed
  );
}

/**
 * Business purpose: Present run-level Preparation status, canonical or observed progress, usage evidence, and persisted event history.
 *
 * Business rules:
 * - Persisted frontier coverage takes precedence over partial stream telemetry; displayed events and token totals remain run-level observations.
 * - Local filters change only loaded timeline rows, and unverified stage or attempt identities are never inferred.
 *
 * Execution flow:
 * 1. Project the selected run's frontier counters or the newest observed progress snapshot.
 * 2. Summarize observed model usage from all loaded events, independent of the selected filter.
 * 3. Present ordered events under an explicitly unclassified group with history pagination controls.
 *
 * Failure cases:
 * - Missing, loading, failed, partial, or inconsistent evidence is labeled and never converted into a fabricated percentage or zero usage.
 *
 * Side effects:
 * - Read-only display and local filter/visible-count state; the page owns existing activity subscriptions and history reads.
 */
export function RuleSetPreparationActivity({
  events,
  frontierCoverage = null,
  frontierCoverageError = false,
  frontierCoverageLoading = false,
  terminal,
  executionState,
  runStatusLabel = null,
  preparationRunId = null,
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
  const [filter, setFilter] = useState<ActivityFilter>(ACTIVITY_FILTERS.ALL);
  const activities = projectPreparationActivity(
    events,
    terminal,
    executionState,
  );
  const usage = preparationTokenUsage(events);
  const usageEvidence = preparationUsageEvidence(events);
  const progress = frontierCoverage
    ? preparationCanonicalProgress(frontierCoverage)
    : preparationProgress(events);
  const canonicalProgress = frontierCoverage !== null;
  const filteredActivities = activities.filter((item) =>
    activityMatchesFilter(item, filter),
  );
  const visibleActivities = filteredActivities.slice(-visibleCount);
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
  const runStatus =
    runStatusLabel ?? resolveAppMessage("pages.preparationOps.notReported");
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
      <dl className="mt-3 grid min-w-0 gap-2 text-sm sm:grid-cols-2">
        <Detail
          labelKey="pages.complianceRuleSets.activity.runStatus"
          value={runStatus}
        />
        <Detail
          labelKey="pages.complianceRuleSets.activity.run"
          value={preparationRunId}
        />
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        {resolveAppMessage(
          canonicalProgress
            ? "pages.complianceRuleSets.activity.canonicalProgress"
            : "pages.complianceRuleSets.activity.observedProgress",
        )}
      </p>
      {frontierCoverageLoading && !canonicalProgress ? (
        <p role="status" className="mt-2 text-sm text-muted-foreground">
          {resolveAppMessage(
            "pages.complianceRuleSets.activity.frontierLoading",
          )}
        </p>
      ) : null}
      {frontierCoverageError ? (
        <p role="status" className="mt-2 text-sm text-muted-foreground">
          {resolveAppMessage(
            "pages.complianceRuleSets.activity.frontierUnavailable",
          )}
        </p>
      ) : null}
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
          <Detail
            labelKey="pages.complianceRuleSets.sourceAnalysis.blockedReferences"
            value={progress.blockedReferences?.toLocaleString() ?? null}
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
            labelKey="pages.complianceRuleSets.activity.requirements"
            value={progress.requirements?.toLocaleString() ?? null}
          />
          <Detail
            labelKey="pages.complianceRuleSets.activity.rules"
            value={progress.rules?.toLocaleString() ?? null}
          />
        </dl>
      ) : null}
      {progress && coverageRate ? (
        <div
          className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label={resolveAppMessage(
            "pages.complianceRuleSets.activity.sourceCoverage",
          )}
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.reviewed ?? 0}
        >
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: coverageRate }}
          />
        </div>
      ) : null}
      <section
        className="mt-5 border-t border-border/70 pt-4"
        aria-labelledby="preparation-usage-heading"
      >
        <h4 id="preparation-usage-heading" className="text-sm font-semibold">
          {resolveAppMessage(
            "pages.complianceRuleSets.activity.observedUsageTitle",
          )}
        </h4>
        <p className="mt-1 text-xs text-muted-foreground">
          {resolveAppMessage("pages.preparationOps.observedUsage")}
        </p>
        <dl className="mt-2 grid min-w-0 gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Detail
            labelKey="pages.complianceRuleSets.activity.modelCalls"
            value={preparationModelCalls(events).toLocaleString()}
          />
          <Detail
            labelKey="pages.preparationOps.observedInput"
            value={
              usageEvidence.input
                ? usage.inputTokens.toLocaleString()
                : resolveAppMessage("pages.preparationOps.notReported")
            }
          />
          <Detail
            labelKey="pages.preparationOps.observedOutput"
            value={
              usageEvidence.output
                ? usage.outputTokens.toLocaleString()
                : resolveAppMessage("pages.preparationOps.notReported")
            }
          />
          <Detail
            labelKey="pages.complianceRuleSets.activity.tokenUsage"
            value={
              usageEvidence.total
                ? usage.totalTokens.toLocaleString()
                : resolveAppMessage("pages.preparationOps.notReported")
            }
          />
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
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">
          {resolveAppMessage("pages.complianceRuleSets.activity.historyScope")}
        </p>
      </section>
      <section
        className="mt-5 border-t border-border/70 pt-4"
        aria-labelledby="preparation-timeline-heading"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4
            id="preparation-timeline-heading"
            className="text-sm font-semibold"
          >
            {resolveAppMessage("pages.complianceRuleSets.activity.timeline")}
          </h4>
          <div
            className="flex flex-wrap gap-1"
            role="group"
            aria-label={resolveAppMessage(
              "pages.complianceRuleSets.activity.filters.label",
            )}
          >
            {ACTIVITY_FILTER_ORDER.map((activityFilter) => (
              <Button
                key={activityFilter}
                type="button"
                size="sm"
                variant={filter === activityFilter ? "default" : "outline"}
                aria-pressed={filter === activityFilter}
                onClick={() => setFilter(activityFilter)}
              >
                {resolveAppMessage(
                  `pages.complianceRuleSets.activity.filters.${activityFilter}` as MessageKey,
                )}
              </Button>
            ))}
          </div>
        </div>
        {activities.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            {historyError
              ? resolveAppMessage("pages.preparationOps.historyError")
              : historyLoading
                ? resolveAppMessage("pages.preparationOps.historyLoading")
                : hasOlder
                  ? resolveAppMessage(
                      "pages.complianceRuleSets.activity.emptyHistoryMayContinue",
                    )
                  : resolveAppMessage(
                      "pages.complianceRuleSets.activity.empty",
                    )}
          </p>
        ) : filteredActivities.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            {resolveAppMessage(
              "pages.complianceRuleSets.activity.noFilterMatches",
            )}
          </p>
        ) : (
          <details className="mt-3 rounded-md border border-border/70" open>
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
              {resolveAppMessage(
                "pages.complianceRuleSets.activity.unclassifiedGroup",
              )}
              <span className="ml-2 text-xs text-muted-foreground">
                ({filteredActivities.length})
              </span>
            </summary>
            <p className="px-3 pb-2 text-xs text-muted-foreground">
              {resolveAppMessage(
                "pages.complianceRuleSets.activity.attemptAttributionUnavailable",
              )}
            </p>
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
                          item.status ===
                            ASSESSMENT_RUNTIME_RUN_STATUSES.failed &&
                            "text-destructive",
                          item.status ===
                            ASSESSMENT_RUNTIME_RUN_STATUSES.completed &&
                            "text-emerald-700 dark:text-emerald-400",
                        )}
                      >
                        {resolveAppMessage(
                          item.status ===
                            ASSESSMENT_RUNTIME_RUN_STATUSES.running
                            ? "pages.complianceRuleSets.activity.statuses.RUNNING"
                            : item.status ===
                                ASSESSMENT_RUNTIME_RUN_STATUSES.failed
                              ? "pages.complianceRuleSets.activity.statuses.FAILED"
                              : item.status ===
                                  ASSESSMENT_RUNTIME_RUN_STATUSES.completed
                                ? "pages.complianceRuleSets.activity.statuses.COMPLETED"
                                : item.status ===
                                    PREPARATION_STAGE_OBSERVATIONS.NOT_REPORTED
                                  ? "pages.preparationOps.notReported"
                                  : item.status ===
                                      AGENT_EXECUTION_STATES.PAUSED
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
                      <Detail
                        labelKey="pages.complianceRuleSets.activity.emittedAt"
                        value={item.event.emittedAt}
                      />
                    </dl>
                  </WorkDisclosure>
                </li>
              ))}
            </ol>
          </details>
        )}
      </section>
      <div className="mt-3 flex flex-wrap gap-2">
        <p>
          {resolveAppMessage("pages.preparationOps.visibleHistory")}:{" "}
          {visibleActivities.length} / {filteredActivities.length}
        </p>
        {filteredActivities.length > visibleCount ? (
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
      <dd className="wrap-break-word">{value}</dd>
    </div>
  );
}
