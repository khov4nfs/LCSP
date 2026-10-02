import {
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  type AssessmentAgentStreamEvent,
} from "@lcsp/contracts/evidence";

import type { AgentStreamRuleQueue } from "../types/agent-stream-rule-analysis-progress.types";
import type { AgentStreamRuleHeader } from "../types/agent-stream-rule.types";

/**
 * Rule analysis works one EngineeringRule at a time, in plan order. A
 * dispatch can be retried (e.g. redelivered after a worker restart) under the
 * same correlation, so its events may hold several attempts: a rule the first
 * attempt was on when it died never completes there. Present the queue as the
 * worker runs it: rules in first-investigated (plan) order, and exactly one
 * rule running — the one with the newest activity; any other still-running
 * rule was cut off and is shown as stopped.
 */
export function orderRuleAnalysisRuleQueue(
  rules: AgentStreamRuleHeader[],
  events: readonly AssessmentAgentStreamEvent[],
  /** Optional explicit rule order.
   *  Loaded history can start mid-dispatch, so first-seen order is a fallback. */
  planOrder: readonly string[] = [],
  /** The dispatch is still running: unfinished rules after the current one
   *  are queued for this attempt, not stopped. */
  dispatchRunning = false,
): AgentStreamRuleQueue {
  const planIndex = new Map(planOrder.map((ruleId, index) => [ruleId, index]));
  const firstSeen = new Map<string, number>();
  const lastSeen = new Map<string, number>();
  for (const event of events) {
    const ruleId = event.engineeringRuleId;
    if (!ruleId) continue;
    firstSeen.set(ruleId, Math.min(firstSeen.get(ruleId) ?? Infinity, event.sequence));
    lastSeen.set(ruleId, Math.max(lastSeen.get(ruleId) ?? -Infinity, event.sequence));
  }
  const running = ASSESSMENT_RUNTIME_RUN_STATUSES.running;
  const current = rules
    .filter((rule) => rule.status === running)
    .reduce<AgentStreamRuleHeader | null>(
      (latest, rule) =>
        latest === null ||
        (lastSeen.get(rule.ruleId) ?? rule.sequence) >
          (lastSeen.get(latest.ruleId) ?? latest.sequence)
          ? rule
          : latest,
      null,
    );
  const ordered = [...rules].sort(
    (a, b) =>
      (planIndex.get(a.ruleId) ?? Infinity) -
        (planIndex.get(b.ruleId) ?? Infinity) ||
      (firstSeen.get(a.ruleId) ?? a.sequence) -
        (firstSeen.get(b.ruleId) ?? b.sequence),
  );
  const currentIndex = current
    ? ordered.findIndex((rule) => rule.ruleId === current.ruleId)
    : -1;
  const queuedRuleIds = new Set<string>();
  const queue = ordered.map((rule, index) => {
    const unfinished =
      rule.status !== ASSESSMENT_RUNTIME_RUN_STATUSES.completed;
    if (dispatchRunning && currentIndex >= 0 && index > currentIndex && unfinished) {
      queuedRuleIds.add(rule.ruleId);
      // Stale "running" from a dead attempt; it is only waiting its turn now.
      return rule.status === running
        ? { ...rule, status: ASSESSMENT_RUNTIME_RUN_STATUSES.waiting }
        : rule;
    }
    return rule.status === running && rule.ruleId !== current?.ruleId
      ? { ...rule, status: ASSESSMENT_RUNTIME_RUN_STATUSES.failed }
      : rule;
  });
  return { rules: queue, queuedRuleIds };
}
