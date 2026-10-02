import { ASSESSMENT_RUNTIME_RUN_STATUSES } from "@lcsp/contracts/evidence";
import { resolveMessage } from "@lcsp/i18n";
import { CheckCircle2, CircleDashed, LoaderCircle, XCircle } from "lucide-react";

import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

import type { AgentStreamRuleAnalysisProgressProps } from "../../types/agent-stream-rule-analysis-progress.types";
import type { AgentStreamRuleHeader } from "../../types/agent-stream-rule.types";
import { orderRuleAnalysisRuleQueue } from "../../utils/agent-stream-rule-analysis-progress";
import { AgentStreamActivityLog } from "./agent-stream-activity-log";
import { AgentStreamRuleAnalysisRuleResult } from "./agent-stream-rule-analysis-output";
import { AgentStreamTimeline } from "./agent-stream-timeline";

/**
 * Rule analysis works one EngineeringRule at a time. Each rule is one row
 * of the same conversation turn: what it investigates, its status, its live
 * activity while it runs, then its own result as agent output — each rule
 * followed by its own Technical details rather than one combined feed.
 */
export function AgentStreamRuleAnalysisProgress({
  rules,
  events,
  planOrder,
  dispatchRunning = false,
}: AgentStreamRuleAnalysisProgressProps) {
  const { rules: ordered, queuedRuleIds } = orderRuleAnalysisRuleQueue(
    rules,
    events,
    planOrder,
    dispatchRunning,
  );
  if (ordered.length === 0) return null;
  return (
    <ol
      data-stream-rule-analysis-progress
      className="mt-3 min-w-0 space-y-2 text-sm"
    >
      {ordered.map((rule, index) => {
        const ruleEvents = events.filter(
          (event) => event.engineeringRuleId === rule.ruleId,
        );
        const running = rule.status === ASSESSMENT_RUNTIME_RUN_STATUSES.running;
        const queued = queuedRuleIds.has(rule.ruleId);
        const header = (
          <span className="flex min-w-0 items-start gap-2">
            <RuleStatusIcon rule={rule} queued={queued} />
            <span className="min-w-0">
              <span className="block break-words font-medium text-foreground">
                {ruleLabel(rule, index)}
              </span>
              <span
                data-stream-rule-analysis-rule-status={
                  queued ? RULE_ANALYSIS_ROW_STATES.queued : rule.status
                }
                className={cn(
                  "block text-xs text-muted-foreground",
                  !queued &&
                    rule.status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed &&
                    "text-destructive",
                )}
              >
                {queued
                  ? t("pages.appShell.agentStreamTurn.ruleQueued")
                  : statusLabel(rule)}
              </span>
            </span>
          </span>
        );
        return (
          <li
            key={rule.ruleId}
            data-stream-rule-analysis-progress-rule={rule.ruleId}
            className="min-w-0 rounded-lg border border-border/50 bg-background/40 px-3 py-2"
          >
            {header}
            <div className="pl-5.5">
              {running ? (
                <AgentStreamActivityLog events={ruleEvents} />
              ) : queued ? null : (
                <div className="mt-2">
                  <AgentStreamRuleAnalysisRuleResult rule={rule} />
                </div>
              )}
              {ruleEvents.length > 0 ? (
                <details
                  data-slot="agent-stream-rule-technical-details"
                  className="mt-2"
                >
                  <summary className="cursor-pointer list-none text-xs font-medium text-muted-foreground select-none">
                    {t("pages.appShell.agentStreamTechnicalDetails")} ·{" "}
                    {ruleEvents.length}
                  </summary>
                  {running ? null : (
                    <AgentStreamActivityLog events={ruleEvents} />
                  )}
                  <div className="mt-1.5">
                    <AgentStreamTimeline events={ruleEvents} embedded />
                  </div>
                </details>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function RuleStatusIcon({
  rule,
  queued,
}: {
  rule: AgentStreamRuleHeader;
  queued: boolean;
}) {
  const className = "mt-0.5 size-3.5 shrink-0";
  if (queued) {
    return <CircleDashed className={cn(className, "text-muted-foreground")} />;
  }
  switch (rule.status) {
    case ASSESSMENT_RUNTIME_RUN_STATUSES.running:
      return (
        <LoaderCircle
          className={cn(className, "animate-spin text-muted-foreground")}
        />
      );
    case ASSESSMENT_RUNTIME_RUN_STATUSES.failed:
      return <XCircle className={cn(className, "text-destructive")} />;
    case ASSESSMENT_RUNTIME_RUN_STATUSES.waiting:
      return (
        <CircleDashed className={cn(className, "text-muted-foreground")} />
      );
    default:
      return <CheckCircle2 className={cn(className, "text-emerald-500")} />;
  }
}

/** UI-only row state: the running attempt has not reached this rule yet. */
const RULE_ANALYSIS_ROW_STATES = {
  queued: "queued",
} as const;

/** What the rule investigates, in words — never its raw ID. */
function ruleLabel(rule: AgentStreamRuleHeader, index: number): string {
  return (
    rule.goals[0] ??
    t("pages.appShell.agentStreamTurn.ruleFallback").replace(
      "{index}",
      String(index + 1),
    )
  );
}

function statusLabel(rule: AgentStreamRuleHeader): string {
  switch (rule.status) {
    case ASSESSMENT_RUNTIME_RUN_STATUSES.running:
      return t("pages.appShell.agentStreamTurn.ruleInvestigating");
    case ASSESSMENT_RUNTIME_RUN_STATUSES.failed:
      return t("pages.appShell.agentStreamTurn.ruleFailed");
    case ASSESSMENT_RUNTIME_RUN_STATUSES.waiting:
      return t("pages.appShell.agentStreamTurn.ruleWaiting");
    default:
      return t("pages.appShell.agentStreamTurn.ruleInvestigated");
  }
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
