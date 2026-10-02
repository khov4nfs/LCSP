import type { AssessmentAgentStreamEvent } from "@lcsp/contracts/evidence";
import { resolveMessage } from "@lcsp/i18n";

import { appLocale } from "@/lib/locale";

/**
 * "Thinking..." while the agent works, then "Thought for N seconds" measured from
 * the agent's own stream events. Without a measurable window the label never
 * invents a number.
 */
export function agentThinkingLabel(
  running: boolean,
  events: readonly AssessmentAgentStreamEvent[],
): string {
  if (running) return t("pages.assessmentFlow.thinking.running");
  const seconds = agentThinkingSeconds(events);
  return seconds === null
    ? t("pages.assessmentFlow.thinking.completedWithoutDuration")
    : t("pages.assessmentFlow.thinking.completed").replace(
        "{seconds}",
        String(seconds),
      );
}

export function agentThinkingSeconds(
  events: readonly AssessmentAgentStreamEvent[],
): number | null {
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    const at = Date.parse(event.emittedAt);
    if (Number.isNaN(at)) continue;
    if (at < first) first = at;
    if (at > last) last = at;
  }
  if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
  return Math.max(1, Math.round((last - first) / 1000));
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
