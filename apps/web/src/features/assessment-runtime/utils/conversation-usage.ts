import type { AssessmentEvent } from "@lcsp/contracts/assessment";
import type { UsageTotals } from "../types/conversation.types";

const ZERO: UsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  invocations: 0,
};

export function addUsage(
  total: UsageTotals | null,
  next: UsageTotals,
): UsageTotals {
  const base = total ?? ZERO;
  return {
    inputTokens: base.inputTokens + next.inputTokens,
    outputTokens: base.outputTokens + next.outputTokens,
    totalTokens: base.totalTokens + next.totalTokens,
    invocations: base.invocations + next.invocations,
  };
}

/** The canonical usage one event carries, or null when it carries none. */
export function eventUsage(
  event: AssessmentEvent,
): { invocationId: string; usage: UsageTotals } | null {
  const usage = event.tokenUsage;
  if (!usage) return null;
  return {
    invocationId: usage.invocationId,
    usage: {
      inputTokens: usage.promptTokens,
      outputTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      invocations: 1,
    },
  };
}

/**
 * Counts a model invocation once however many events or callbacks mention it. `seen` is shared
 * by the whole projection, so a duplicate callback never inflates a group, a turn or the total.
 */
export function takeUsage(
  event: AssessmentEvent,
  seen: Set<string>,
): { invocationId: string; usage: UsageTotals } | null {
  const found = eventUsage(event);
  if (!found || seen.has(found.invocationId)) return null;
  seen.add(found.invocationId);
  return found;
}

export function sumTurnUsage(
  items: readonly { usage: UsageTotals | null }[],
): UsageTotals | null {
  return items.reduce<UsageTotals | null>(
    (total, item) => (item.usage ? addUsage(total, item.usage) : total),
    null,
  );
}
