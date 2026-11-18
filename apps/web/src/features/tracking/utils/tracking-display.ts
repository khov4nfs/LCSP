import { resolveMessage, type MessageKey } from "@lcsp/i18n";
import type { AdminTrackingUnreconciledUsage } from "@lcsp/contracts/assessment-domain";
import { appLocale } from "@/lib/locale";
import { formatLocaleDateTimeWithYear } from "@/lib/date-format";

export interface ModelUsageSummary {
  model: string;
  totalTokens: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  runCount: number;
  unreconciledCount: number;
  reconciledCount: number;
  items: AdminTrackingUnreconciledUsage[];
}

/**
 * Business purpose:
 * Aggregate granular operational tracking usage events into model-level consumption totals.
 *
 * Business rules:
 * - Group events by their exact model identifier string.
 * - Sum total tokens, input prompt tokens, and output completion tokens when numerical values are present.
 * - Count the number of total runs, reconciled events, and unreconciled events for each model.
 * - Preserve reverse-chronological order of individual execution items within each model group.
 *
 * Execution flow:
 * 1. Iterate over all usage events and register or accumulate them into a model map.
 * 2. For existing models, increment run count, update reconciliation counts, and sum available token counts.
 * 3. Sort the resulting model summaries alphabetically by model name.
 * 4. Return the aggregated list of model summaries.
 *
 * Failure cases:
 * - When the input array is empty, return an empty array.
 * - When all token records for a model are null, totalTokens remains null.
 *
 * Side effects:
 * - Pure calculation without database or external side effects.
 */
export function groupUsageByModel(
  items: AdminTrackingUnreconciledUsage[],
): ModelUsageSummary[] {
  const map = new Map<string, ModelUsageSummary>();

  for (const item of items) {
    const existing = map.get(item.model);
    if (!existing) {
      map.set(item.model, {
        model: item.model,
        totalTokens: item.totalTokens,
        promptTokens: item.promptTokens,
        completionTokens: item.completionTokens,
        runCount: 1,
        unreconciledCount: item.reconciled ? 0 : 1,
        reconciledCount: item.reconciled ? 1 : 0,
        items: [item],
      });
    } else {
      existing.runCount += 1;
      if (item.reconciled) {
        existing.reconciledCount += 1;
      } else {
        existing.unreconciledCount += 1;
      }
      if (item.totalTokens !== null) {
        existing.totalTokens = (existing.totalTokens ?? 0) + item.totalTokens;
      }
      if (item.promptTokens !== null) {
        existing.promptTokens =
          (existing.promptTokens ?? 0) + item.promptTokens;
      }
      if (item.completionTokens !== null) {
        existing.completionTokens =
          (existing.completionTokens ?? 0) + item.completionTokens;
      }
      existing.items.push(item);
    }
  }

  return Array.from(map.values()).sort((a, b) => a.model.localeCompare(b.model));
}

/**
 * Business purpose: Resolve tracking copy in the active application locale.
 * Business rules:
 * - The suffix must identify a tracking message key already present in the i18n catalog.
 * Execution flow:
 * 1. Prefix the tracking namespace and resolve the message for the current locale.
 * Failure cases:
 * - Missing catalog keys follow the shared i18n resolver's missing-key behavior.
 * Side effects:
 * - None: reads the active locale and catalog without changing application state.
 */
export function trackingMessage(suffix: string) {
  return resolveMessage(
    appLocale,
    `pages.workspace.tracking.${suffix}` as MessageKey,
  );
}

/**
 * Business purpose: Display tracking event time consistently with the workspace date format.
 * Business rules:
 * - Null or invalid timestamps use the shared date formatter's unavailable marker.
 * Execution flow:
 * 1. Delegate the timestamp to the locale-aware date and time formatter.
 * Failure cases:
 * - Invalid date values produce the shared unavailable marker instead of an invented date.
 * Side effects:
 * - None: returns display text without modifying tracking data.
 */
export function formatTrackingDate(value: string | null | undefined) {
  return formatLocaleDateTimeWithYear(value);
}
