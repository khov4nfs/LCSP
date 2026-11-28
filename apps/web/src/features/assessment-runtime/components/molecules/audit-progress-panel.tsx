import type { ReactNode } from "react";
import { LoaderCircleIcon, RotateCcwIcon } from "lucide-react";
import { RULE_AUDIT_PROGRESS_STATES } from "@lcsp/contracts/assessment-domain";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { resolveAppMessage } from "@/lib/i18n";
import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

import { copy } from "../../utils/conversation-copy";

export interface AuditProgressItem {
  assessmentRuleId: string;
  concept: string;
  progress: string;
  decisionId?: string | null;
}

/**
 * Business purpose: Display durable per-rule progress for an active or partial selected-rule audit (`LCSP Data / Panel state / Loading` `1681:1327` & `LCSP Data / Status / info` `1681:1303`).
 * Business rules:
 * - Completed rules (`RESULT_READY`) expose `View result` immediately without waiting for remaining rules to finish.
 * - Failed or interrupted rules expose `Retry` without auto-retrying or discarding completed findings.
 * Execution flow:
 * 1. Compute ready vs total count from `items`.
 * 2. Render header summary and per-rule progress rows with semantic status badges and actions.
 * Failure cases:
 * - Empty `items` renders nothing.
 * Side effects:
 * - Invokes `onViewResult(decisionId)` or `onRetryRule(assessmentRuleId)`.
 */
export function AuditProgressPanel({
  items,
  retrying = false,
  paused = false,
  runtimeControls,
  onViewResult,
  onRetryRule,
}: {
  items: readonly AuditProgressItem[];
  retrying?: boolean;
  paused?: boolean;
  runtimeControls?: ReactNode;
  onViewResult?: (decisionId: string) => void;
  onRetryRule?: (assessmentRuleId: string) => void;
}) {
  if (items.length === 0) return null;

  const readyCount = items.filter(
    (item) => item.progress === RULE_AUDIT_PROGRESS_STATES.RESULT_READY,
  ).length;
  const hasRunning =
    !paused &&
    items.some(
      (item) =>
        item.progress === RULE_AUDIT_PROGRESS_STATES.QUEUED ||
        item.progress === RULE_AUDIT_PROGRESS_STATES.INVESTIGATING,
    );

  const summary = resolveAppMessage(
    "pages.assessmentWorkspace.selectedAudit.resultsReadySummary",
  )
    .replace("{ready}", readyCount.toLocaleString(appLocale))
    .replace("{total}", items.length.toLocaleString(appLocale));

  return (
    <section
      aria-label={resolveAppMessage(
        "pages.assessmentWorkspace.selectedAudit.progressTitle",
      )}
      className="rounded-xl border border-border bg-card p-4 shadow-xs"
      data-component="AuditProgressPanel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          {hasRunning ? (
            <LoaderCircleIcon
              className="size-4 animate-spin text-status-info motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : null}
          <h3 className="text-sm font-semibold text-foreground">
            {resolveAppMessage(
              "pages.assessmentWorkspace.selectedAudit.progressTitle",
            )}
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {paused ? (
            <Badge
              variant="outline"
              className="border-status-warning-border bg-status-warning-bg text-status-warning"
            >
              {copy("state.PAUSED")}
            </Badge>
          ) : null}
          <span className="text-xs font-medium text-muted-foreground">
            {summary}
          </span>
          {runtimeControls}
        </div>
      </div>

      <ul className="mt-3 divide-y divide-border">
        {items.map((item) => {
          const isReady =
            item.progress === RULE_AUDIT_PROGRESS_STATES.RESULT_READY;
          const isFailed =
            item.progress === RULE_AUDIT_PROGRESS_STATES.FAILED ||
            item.progress === RULE_AUDIT_PROGRESS_STATES.INTERRUPTED;
          const isWaiting =
            item.progress === RULE_AUDIT_PROGRESS_STATES.WAITING_FOR_CUSTOMER;

          return (
            <li
              key={item.assessmentRuleId}
              className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {item.concept}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    isReady
                      ? "border-status-success-border bg-status-success-bg text-status-success"
                      : isFailed
                        ? "border-status-danger-border bg-status-danger-bg text-status-danger"
                        : isWaiting
                          ? "border-status-warning-border bg-status-warning-bg text-status-warning"
                          : "border-status-info-border bg-status-info-bg text-status-info",
                  )}
                >
                  {copy(`ruleAudit.progress.${item.progress}`)}
                </Badge>

                {isReady && item.decisionId && onViewResult ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onViewResult(item.decisionId!)}
                  >
                    {copy("ruleAudit.viewResult")}
                  </Button>
                ) : null}

                {isFailed && onRetryRule ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={retrying}
                    onClick={() => onRetryRule(item.assessmentRuleId)}
                  >
                    <RotateCcwIcon
                      className="mr-1.5 size-3.5"
                      aria-hidden="true"
                    />
                    {copy("ruleAudit.retry")}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
