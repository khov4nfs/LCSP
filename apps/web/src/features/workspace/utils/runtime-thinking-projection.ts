import {
  RULE_ANALYSIS_ACTIVITIES,
  type AssessmentRuntimeEngineeringProgress,
} from "@lcsp/contracts/evidence";
import { resolveMessage } from "@lcsp/i18n";

import { appLocale } from "../../../lib/locale";
import {
  RULE_ANALYSIS_ACTIVITY_SUMMARY_TOOL,
  RULE_ANALYSIS_ACTIVITY_TOOL_PREFIX,
} from "../config/runtime-activity";
import {
  RUNTIME_THINKING_PHASES,
  type RuntimeThinkingItem,
  type RuntimeThinkingPhase,
  type WorkspaceRuntimeActivityItem,
  type WorkspaceRuntimeSummaryValue,
} from "../types/workspace-runtime.types";
import { interpolateRuntimeSummary } from "./runtime-activity-summary";

/**
 * Aggregates rule-analysis telemetry into customer-facing progress.
 *
 * Rule IDs and activity codes never reach the chat: the raw events stay available in
 * the runtime console, logs and audit. The durable progress from the API is
 * authoritative; the recent-activity window is only a fallback until it arrives.
 */
export function projectRuntimeThinking(
  recentActivity: WorkspaceRuntimeActivityItem[],
  engineeringProgress: AssessmentRuntimeEngineeringProgress[] = [],
): RuntimeThinkingItem[] {
  const progress =
    engineeringProgress[0] ?? progressFromActivity(recentActivity);
  return progress ? projectProgress(progress) : [];
}

function projectProgress(
  progress: AssessmentRuntimeEngineeringProgress,
): RuntimeThinkingItem[] {
  const pending = Math.max(
    progress.eligibleCount -
      progress.completed -
      progress.needsContext -
      progress.unresolved -
      progress.failed,
    0,
  );
  const id = `${progress.assessmentId}:${progress.runId}`;
  const items: RuntimeThinkingItem[] = [
    {
      id: `analysis:${id}`,
      phase: RUNTIME_THINKING_PHASES.analysis,
      limited: false,
      messageKey: "pages.assessmentFlow.technicalEvidence.ruleAnalysisSummary",
      params: {
        completed: String(progress.completed),
        eligible: String(progress.eligibleCount),
        total: String(progress.engineeringRuleCount),
        pending: String(pending),
      },
    },
  ];
  const limited: Array<[number, string, string]> = [
    [
      progress.needsContext,
      "needs-context",
      "pages.assessmentFlow.technicalEvidence.ruleAnalysisNeedsContextSummary",
    ],
    [
      progress.unresolved,
      "unresolved",
      "pages.assessmentFlow.technicalEvidence.ruleAnalysisUnresolvedSummary",
    ],
    [
      progress.failed,
      "failed",
      "pages.assessmentFlow.technicalEvidence.ruleAnalysisFailedSummary",
    ],
  ];
  for (const [count, key, messageKey] of limited) {
    if (count > 0) {
      items.push({
        id: `analysis-${key}:${id}`,
        phase: RUNTIME_THINKING_PHASES.analysis,
        limited: true,
        messageKey: messageKey as RuntimeThinkingItem["messageKey"],
        params: { count: String(count) },
      });
    }
  }
  return items;
}

/** Fallback derived from the recent window, mirroring the API's derivation. */
function progressFromActivity(
  recentActivity: WorkspaceRuntimeActivityItem[],
): AssessmentRuntimeEngineeringProgress | null {
  const summary = recentActivity
    .filter((item) => item.toolName === RULE_ANALYSIS_ACTIVITY_SUMMARY_TOOL)
    .reduce<WorkspaceRuntimeActivityItem | null>(
      (newest, item) =>
        newest === null || item.sequence > newest.sequence ? item : newest,
      null,
    );
  if (!summary) return null;
  const output = summaryRecord(summary.outputSummary);
  const latest = new Map<string, WorkspaceRuntimeActivityItem>();
  for (const item of recentActivity) {
    if (
      item.runId !== summary.runId ||
      item.sequence <= summary.sequence ||
      !item.toolName?.startsWith(RULE_ANALYSIS_ACTIVITY_TOOL_PREFIX)
    ) {
      continue;
    }
    const current = latest.get(item.toolName);
    if (!current || item.sequence > current.sequence) {
      latest.set(item.toolName, item);
    }
  }
  const counts = { completed: 0, needsContext: 0, unresolved: 0, failed: 0 };
  for (const item of latest.values()) {
    const activity = summaryRecord(item.outputSummary)?.activity;
    if (activity === RULE_ANALYSIS_ACTIVITIES.ruleAnalysisCompleted) {
      counts.completed += 1;
    } else if (
      activity === RULE_ANALYSIS_ACTIVITIES.ruleAnalysisNeedsContext ||
      activity === RULE_ANALYSIS_ACTIVITIES.businessContextRequested
    ) {
      counts.needsContext += 1;
    } else if (activity === RULE_ANALYSIS_ACTIVITIES.ruleAnalysisUnresolved) {
      counts.unresolved += 1;
    } else if (activity === RULE_ANALYSIS_ACTIVITIES.ruleAnalysisFailed) {
      counts.failed += 1;
    }
  }
  return {
    assessmentId: summary.assessmentId,
    runId: summary.runId,
    contextRevision: numberOrNull(output?.contextRevision),
    engineeringRuleCount: numberOrZero(output?.engineeringRuleCount),
    eligibleCount: numberOrZero(output?.eligibleCount),
    ...counts,
  };
}

export function formatRuntimeThinkingItem(item: RuntimeThinkingItem): string {
  return interpolateRuntimeSummary(
    resolveMessage(appLocale, item.messageKey),
    item.params,
  );
}

export function runtimeThinkingPhase(
  activity: WorkspaceRuntimeActivityItem,
): RuntimeThinkingPhase | null {
  return activity.toolName === RULE_ANALYSIS_ACTIVITY_SUMMARY_TOOL ||
    activity.toolName?.startsWith(RULE_ANALYSIS_ACTIVITY_TOOL_PREFIX)
    ? RUNTIME_THINKING_PHASES.analysis
    : null;
}

function numberOrNull(value: WorkspaceRuntimeSummaryValue | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberOrZero(value: WorkspaceRuntimeSummaryValue | undefined) {
  return Math.max(0, Math.floor(numberOrNull(value) ?? 0));
}

function summaryRecord(
  value: WorkspaceRuntimeSummaryValue | null,
): Record<string, WorkspaceRuntimeSummaryValue> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
}
