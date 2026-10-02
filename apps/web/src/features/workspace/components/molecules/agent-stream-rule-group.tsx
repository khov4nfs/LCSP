import { ASSESSMENT_RUNTIME_RUN_STATUSES } from "@lcsp/contracts/evidence";
import { resolveMessage } from "@lcsp/i18n";
import {
  CheckCircle2,
  ChevronDown,
  Clock,
  ListChecks,
  LoaderCircle,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";

import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

import { RULE_ANALYSIS_ACTIVITY_KEYS } from "../../config/rule-analysis-activity-keys";
import type {
  AgentStreamRuleClaim,
  AgentStreamRuleHeader,
} from "../../types/agent-stream-rule.types";

type AgentStreamRuleGroupProps = {
  header: AgentStreamRuleHeader;
  children?: ReactNode;
  /** Keep the rule's result (decision/reasonCode/claims) visible even after
   *  it finishes, for callers that show it as an always-visible output card
   *  rather than a raw activity accordion (which auto-collapses on finish). */
  forceOpen?: boolean;
  /** Show the raw decision/reasonCode/claimType codes (e.g. "SELECT",
   *  "HUMAN_REVIEW_GATE_FOUND"). Default true for the raw activity timeline;
   *  an always-visible output card passes false and relies on the claim's
   *  own natural-language criterion instead — the raw codes stay reachable
   *  through Technical details. */
  showRawDecision?: boolean;
};

/**
 * One EngineeringRule inside the live agent stream: which rule is being
 * investigated, that rule's own activity rows, then its reasoning result.
 */
export function AgentStreamRuleGroup({
  header,
  children,
  forceOpen = false,
  showRawDecision = true,
}: AgentStreamRuleGroupProps) {
  const labels = ruleLabels();
  const running = header.status === ASSESSMENT_RUNTIME_RUN_STATUSES.running;
  const failed = header.status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed;
  const description = header.concept ?? header.ruleId;

  return (
    <div
      data-stream-rule={header.ruleId}
      data-stream-rule-status={header.status}
      className="relative min-w-0 pl-6"
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-2.5 left-0 z-10 flex size-4 items-center justify-center rounded-full bg-background text-muted-foreground",
          failed && "text-destructive",
          header.status === ASSESSMENT_RUNTIME_RUN_STATUSES.completed &&
            "text-emerald-500",
        )}
      >
        <RuleStatusIcon status={header.status} />
      </span>
      <details
        open={running || forceOpen}
        className={cn(
          "group/rule min-w-0 rounded-xl border border-border/60 bg-muted/10 px-2.5 py-2 text-xs",
          failed && "border-destructive/30 bg-destructive/5",
        )}
      >
        <summary className="flex cursor-pointer list-none items-center gap-2 select-none">
          <ListChecks
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground"
          />
          <span
            className={cn(
              "min-w-0 flex-1 break-words font-medium text-foreground",
              failed && "text-destructive",
            )}
          >
            {ruleTitle(header, labels)}
            {description ? `: ${description}` : ""}
          </span>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground transition-transform duration-200 group-open/rule:rotate-180" />
        </summary>
        {header.activity ? (
          <div
            data-stream-rule-activity={header.activity}
            className="mt-1 break-words text-muted-foreground"
          >
            {t(RULE_ANALYSIS_ACTIVITY_KEYS[header.activity])}
          </div>
        ) : null}
        {children ? <div className="mt-2 space-y-0.5">{children}</div> : null}
        <RuleResult
          header={header}
          labels={labels}
          showRawDecision={showRawDecision}
        />
      </details>
    </div>
  );
}

function RuleResult({
  header,
  labels,
  showRawDecision,
}: {
  header: AgentStreamRuleHeader;
  labels: ReturnType<typeof ruleLabels>;
  showRawDecision: boolean;
}) {
  if (
    header.decision === null &&
    header.reasonCode === null &&
    header.claims.length === 0
  ) {
    return null;
  }
  return (
    <div
      data-stream-rule-result
      className="mt-2 space-y-1.5 border-t border-border/40 pt-2"
    >
      <div className="font-medium text-foreground">{labels.result}</div>
      {showRawDecision && header.decision ? (
        <div className="text-foreground/90">
          {labels.decision}:{" "}
          <code className="font-mono">{header.decision}</code>
        </div>
      ) : null}
      {showRawDecision && header.reasonCode ? (
        <div className="text-muted-foreground">
          {labels.reason}:{" "}
          <code className="font-mono">{header.reasonCode}</code>
        </div>
      ) : null}
      {header.claims.length > 0 ? (
        <ul className="space-y-1.5">
          {header.claims.map((claim, index) => (
            <RuleClaim
              key={`${claim.claimType}:${claim.criterion ?? index}`}
              claim={claim}
              labels={labels}
              showRawDecision={showRawDecision}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function RuleClaim({
  claim,
  labels,
  showRawDecision,
}: {
  claim: AgentStreamRuleClaim;
  labels: ReturnType<typeof ruleLabels>;
  showRawDecision: boolean;
}) {
  return (
    <li className="rounded-lg border border-border/50 bg-background/60 px-2.5 py-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {showRawDecision ? (
          <code className="font-mono font-medium text-foreground">
            {claim.claimType}
          </code>
        ) : null}
        {claim.confidence !== null ? (
          <span className="text-muted-foreground">
            {labels.confidence}: {Math.round(claim.confidence * 100)}%
          </span>
        ) : null}
      </div>
      {claim.criterion ? (
        <div className="mt-0.5 break-words text-foreground/90">
          {claim.criterion}
        </div>
      ) : null}
      {claim.sourceLocations ? (
        <div className="mt-0.5 break-all font-mono text-muted-foreground">
          {labels.sources}: {claim.sourceLocations}
        </div>
      ) : null}
      {claim.limitations.length > 0 ? (
        <div className="mt-0.5 break-words text-muted-foreground">
          {labels.limitations}: {claim.limitations.join(", ")}
        </div>
      ) : null}
    </li>
  );
}

function RuleStatusIcon({
  status,
}: {
  status: AgentStreamRuleHeader["status"];
}) {
  switch (status) {
    case ASSESSMENT_RUNTIME_RUN_STATUSES.running:
      return <LoaderCircle className="size-3.5 animate-spin" />;
    case ASSESSMENT_RUNTIME_RUN_STATUSES.completed:
      return <CheckCircle2 className="size-3.5" />;
    case ASSESSMENT_RUNTIME_RUN_STATUSES.failed:
      return <XCircle className="size-3.5" />;
    default:
      return <Clock className="size-3.5" />;
  }
}

function ruleTitle(
  header: AgentStreamRuleHeader,
  labels: ReturnType<typeof ruleLabels>,
): string {
  if (header.status === ASSESSMENT_RUNTIME_RUN_STATUSES.waiting) {
    return labels.waitingForInput;
  }
  switch (header.status) {
    case ASSESSMENT_RUNTIME_RUN_STATUSES.completed:
      return labels.investigated;
    case ASSESSMENT_RUNTIME_RUN_STATUSES.failed:
      return labels.investigationFailed;
    default:
      return labels.investigating;
  }
}

function ruleLabels() {
  return {
    investigating: t("pages.appShell.agentStreamRule.investigating"),
    investigated: t("pages.appShell.agentStreamRule.investigated"),
    investigationFailed: t(
      "pages.appShell.agentStreamRule.investigationFailed",
    ),
    waitingForInput: t("pages.appShell.agentStreamRule.waitingForInput"),
    result: t("pages.appShell.agentStreamRule.result"),
    decision: t("pages.appShell.agentStreamRule.decision"),
    reason: t("pages.appShell.agentStreamRule.reason"),
    confidence: t("pages.appShell.agentStreamRule.confidence"),
    sources: t("pages.appShell.agentStreamRule.sources"),
    limitations: t("pages.appShell.agentStreamRule.limitations"),
  };
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
