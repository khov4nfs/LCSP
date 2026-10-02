import { ASSESSMENT_RUNTIME_RUN_STATUSES } from "@lcsp/contracts/evidence";
import { resolveMessage } from "@lcsp/i18n";

import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

import type {
  AgentStreamRuleClaim,
  AgentStreamRuleHeader,
} from "../../types/agent-stream-rule.types";

/**
 * A raw technical label — a rule's own snake_case/kebab-case identifier, or a
 * law/article clause ID like "AUTO-VN-LEGAL-2026-08-134-2025-QH15::art-10" —
 * never belongs in a customer-facing card. Real concept/criterion text is a
 * sentence or phrase and always contains whitespace; codes never do.
 */
function isTechnicalLabel(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.includes("_")) return true;
  if (/^[A-Z0-9_:-]+$/.test(trimmed)) return true;
  if (trimmed.includes("::")) return true;
  if (!/\s/.test(trimmed) && /[-:]/.test(trimmed) && trimmed.length > 8) {
    return true;
  }
  return false;
}

function humanConcept(rule: AgentStreamRuleHeader): string | null {
  return rule.concept && !isTechnicalLabel(rule.concept) ? rule.concept : null;
}

/**
 * Customer-facing rule-analysis results: one card per rule that was actually
 * investigated (not merely selected) AND has something human-readable to
 * show, in natural language. Deliberately does NOT reuse AgentStreamRuleGroup
 * — that component is the raw-timeline view and shows the rule's
 * ruleId/decision/reasonCode/claimType codes, none of which belong here.
 *
 * Rules with no human-readable concept and nothing but a failed/waiting
 * status never render as individual cards (a dispatch-level failure can
 * produce dozens of them, all with the same generic reasonCode and no
 * concept) — they collapse into one count-based summary instead.
 */
export function AgentStreamRuleAnalysisOutput({
  rules,
  dispatchFailed = false,
}: {
  rules: AgentStreamRuleHeader[];
  dispatchFailed?: boolean;
}) {
  const labels = ruleAnalysisLabels();
  if (dispatchFailed)
    return (
      <div
        data-stream-rule-analysis-failure-summary
        className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
      >
        {t("pages.appShell.agentStreamTurn.investigateFailed")}
      </div>
    );
  const displayable = [...rules]
    .filter(hasRuleAnalysisResult)
    .sort((left, right) => left.sequence - right.sequence);
  if (displayable.length === 0) return null;

  const nameable: AgentStreamRuleHeader[] = [];
  const unnameableFailed: AgentStreamRuleHeader[] = [];
  const unnameableWaiting: AgentStreamRuleHeader[] = [];
  for (const rule of displayable) {
    if (
      humanConcept(rule) ||
      rule.claims.some(
        (claim) => claim.criterion && !isTechnicalLabel(claim.criterion),
      )
    ) {
      nameable.push(rule);
      continue;
    }
    if (rule.status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed) {
      unnameableFailed.push(rule);
    } else if (rule.status === ASSESSMENT_RUNTIME_RUN_STATUSES.waiting) {
      unnameableWaiting.push(rule);
    }
  }

  return (
    <div
      data-stream-rule-analysis-output
      className="mt-3 min-w-0 space-y-2 text-sm text-foreground"
    >
      {nameable.map((rule) => (
        <RuleAnalysisRule key={rule.ruleId} rule={rule} labels={labels} />
      ))}
      {unnameableFailed.length > 0 ? (
        <div
          data-stream-rule-analysis-failure-summary
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive"
        >
          {labels.aggregatedFailed} · {unnameableFailed.length}
        </div>
      ) : null}
      {unnameableWaiting.length > 0 ? (
        <div
          data-stream-rule-analysis-waiting-summary
          className="rounded-lg border border-border/50 bg-background/40 px-3 py-2 text-muted-foreground"
        >
          {labels.aggregatedWaiting} · {unnameableWaiting.length}
        </div>
      ) : null}
    </div>
  );
}

/** A rule only belongs here once rule analysis itself produced a result
 *  for it — a bare "selected" status (set by a selection decision event)
 *  is not an investigation outcome. Callers scope `rules` to Investigate-
 *  stage events only, so this only has to separate real outcomes from a
 *  still-running rule with nothing to show yet. */
function hasRuleAnalysisResult(rule: AgentStreamRuleHeader): boolean {
  return (
    rule.claims.length > 0 ||
    rule.status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed ||
    rule.status === ASSESSMENT_RUNTIME_RUN_STATUSES.waiting
  );
}

function RuleAnalysisRule({
  rule,
  labels,
}: {
  rule: AgentStreamRuleHeader;
  labels: ReturnType<typeof ruleAnalysisLabels>;
}) {
  const failed = rule.status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed;
  const concept = humanConcept(rule);
  return (
    <div
      data-stream-rule-analysis-rule
      className={cn(
        "rounded-lg border border-border/50 bg-background/40 px-3 py-2",
        failed && "border-destructive/30 bg-destructive/5",
      )}
    >
      {/* Never a raw label: skip the heading entirely when the concept isn't
       *  human-readable rather than showing an unidentifiable code. */}
      {concept ? (
        <p className="font-medium text-foreground">{concept}</p>
      ) : null}
      <RuleOutcomeMessage
        rule={rule}
        labels={labels}
        failed={failed}
        hasHeading={Boolean(concept)}
      />
      {rule.claims.map((claim, index) => (
        <RuleClaimSummary
          key={`${rule.ruleId}:${index}`}
          claim={claim}
          labels={labels}
        />
      ))}
    </div>
  );
}

/** One finished rule's result, as the rule analysis's own output for that rule:
 *  its outcome and each criterion-scoped finding with sources/confidence. */
export function AgentStreamRuleAnalysisRuleResult({
  rule,
}: {
  rule: AgentStreamRuleHeader;
}) {
  const labels = ruleAnalysisLabels();
  return (
    <div data-stream-rule-analysis-rule-result className="text-sm">
      <RuleOutcomeMessage
        rule={rule}
        labels={labels}
        failed={rule.status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed}
        hasHeading
      />
      {rule.claims.map((claim, index) => (
        <RuleClaimSummary
          key={`${rule.ruleId}:${index}`}
          claim={claim}
          labels={labels}
        />
      ))}
    </div>
  );
}

function RuleOutcomeMessage({
  rule,
  labels,
  failed,
  hasHeading,
}: {
  rule: AgentStreamRuleHeader;
  labels: ReturnType<typeof ruleAnalysisLabels>;
  failed: boolean;
  hasHeading: boolean;
}) {
  if (rule.status === ASSESSMENT_RUNTIME_RUN_STATUSES.waiting) {
    return (
      <p className={cn("mt-0.5 text-muted-foreground", hasHeading && "mt-1")}>
        {labels.waiting}
      </p>
    );
  }
  if (failed) {
    return (
      <p className={cn("mt-0.5 text-destructive", hasHeading && "mt-1")}>
        {labels.failed}
      </p>
    );
  }
  // Completed with claims: the claim's own criterion text below already
  // says what was found, so no separate generic "completed" line is needed.
  if (rule.claims.length > 0) return null;
  return (
    <p className={cn("mt-0.5 text-muted-foreground", hasHeading && "mt-1")}>
      {labels.completed}
    </p>
  );
}

function RuleClaimSummary({
  claim,
  labels,
}: {
  claim: AgentStreamRuleClaim;
  labels: ReturnType<typeof ruleAnalysisLabels>;
}) {
  const criterion =
    claim.criterion && !isTechnicalLabel(claim.criterion)
      ? claim.criterion
      : null;
  if (
    !criterion &&
    !claim.sourceLocations &&
    claim.confidence === null &&
    claim.limitations.length === 0
  ) {
    return null;
  }
  return (
    <div className="mt-1.5 space-y-0.5">
      {criterion ? <p className="text-foreground/90">{criterion}</p> : null}
      {claim.sourceLocations ? (
        <p className="break-all font-mono text-xs text-muted-foreground">
          {labels.evidence}: {claim.sourceLocations}
        </p>
      ) : null}
      {claim.confidence !== null ? (
        <p className="text-xs text-muted-foreground">
          {labels.confidence}: {Math.round(claim.confidence * 100)}%
        </p>
      ) : null}
      {claim.limitations.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {labels.limitations}: {claim.limitations.join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function ruleAnalysisLabels() {
  return {
    completed: t("pages.appShell.agentStreamRuleAnalysisOutput.completed"),
    failed: t("pages.appShell.agentStreamRuleAnalysisOutput.failed"),
    waiting: t("pages.appShell.agentStreamRuleAnalysisOutput.waiting"),
    aggregatedFailed: t(
      "pages.appShell.agentStreamRuleAnalysisOutput.aggregatedFailed",
    ),
    aggregatedWaiting: t(
      "pages.appShell.agentStreamRuleAnalysisOutput.aggregatedWaiting",
    ),
    evidence: t("pages.appShell.agentStreamRule.sources"),
    confidence: t("pages.appShell.agentStreamRule.confidence"),
    limitations: t("pages.appShell.agentStreamRule.limitations"),
  };
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
