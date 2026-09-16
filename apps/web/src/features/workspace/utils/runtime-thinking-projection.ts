import {
  ASSESSMENT_RUNTIME_EVENT_TYPES,
  ASSESSMENT_RUNTIME_PLAN_REASON_CODES,
  ASSESSMENT_RUNTIME_STAGE_CODES,
  type AssessmentRuntimeEngineeringProgress,
} from "@lcsp/contracts/evidence";
import { resolveMessage } from "@lcsp/i18n";

import { appLocale } from "../../../lib/locale";
import { ENGINEERING_RULE_ACTIVITY_TOOL_PREFIXES } from "../config/runtime-activity";
import {
  RUNTIME_THINKING_PHASES,
  type RuntimeThinkingItem,
  type RuntimeThinkingPhase,
  type WorkspaceRuntimeActivityItem,
  type WorkspaceRuntimeSummaryValue,
} from "../types/workspace-runtime.types";
import { interpolateRuntimeSummary } from "./runtime-activity-summary";

/**
 * Aggregates per-rule Planner/Investigator telemetry into customer-facing progress.
 *
 * Rule IDs, reason codes and decision enums never reach the chat: the raw events stay
 * available in the runtime console, logs and audit. A targeted re-plan reuses the
 * scan-job run, so only the latest decision per rule and the Investigator events
 * after that planning batch are counted.
 */
export function projectRuntimeThinking(
  recentActivity: WorkspaceRuntimeActivityItem[],
  engineeringProgress: AssessmentRuntimeEngineeringProgress[] = [],
): RuntimeThinkingItem[] {
  const authoritativeProgress = latestEngineeringProgress(engineeringProgress);
  if (authoritativeProgress) {
    return projectAuthoritativeRuntimeThinking(authoritativeProgress);
  }
  const engineeringActivity = recentActivity.filter(
    (item) =>
      item.stage === ASSESSMENT_RUNTIME_STAGE_CODES.technicalEvidence &&
      activityPhase(item) !== null,
  );
  const latestPlannerDecisions = latestByTool(
    engineeringActivity.filter(
      (item) => activityPhase(item) === RUNTIME_THINKING_PHASES.planner,
    ),
  );
  const planningBatchStart = latestPlannerDecisions.length
    ? Math.min(...latestPlannerDecisions.map((item) => item.sequence))
    : Number.NEGATIVE_INFINITY;
  const latestInvestigations = latestByTool(
    engineeringActivity.filter(
      (item) =>
        activityPhase(item) === RUNTIME_THINKING_PHASES.investigator &&
        item.sequence > planningBatchStart,
    ),
  );

  const items: RuntimeThinkingItem[] = [];
  const selected = latestPlannerDecisions.filter(
    (item) => item.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
  ).length;
  const skipped = latestPlannerDecisions.filter(
    (item) => item.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolSkipped,
  ).length;
  if (latestPlannerDecisions.length > 0) {
    const targeted = latestPlannerDecisions.some(isTargetedExactResumeDecision);
    items.push({
      id: `planner:${newestEventId(latestPlannerDecisions)}`,
      phase: RUNTIME_THINKING_PHASES.planner,
      limited: false,
      messageKey: targeted
        ? "pages.assessmentFlow.technicalEvidence.plannerTargetedSummary"
        : "pages.assessmentFlow.technicalEvidence.plannerSummary",
      params: {
        selected: String(selected),
        skipped: String(skipped),
        total: String(latestPlannerDecisions.length),
      },
    });
  }

  const investigated = latestInvestigations.filter(
    (item) => item.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
  );
  const limited = latestInvestigations.filter(
    (item) => item.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolFailed,
  );
  if (investigated.length > 0) {
    items.push({
      id: `investigator:${newestEventId(investigated)}`,
      phase: RUNTIME_THINKING_PHASES.investigator,
      limited: false,
      messageKey: "pages.assessmentFlow.technicalEvidence.investigatorSummary",
      params: {
        investigated: String(investigated.length),
        selected: String(selected),
        pending: String(
          Math.max(selected - investigated.length - limited.length, 0),
        ),
      },
    });
  }
  if (limited.length > 0) {
    items.push({
      id: `investigator-limited:${newestEventId(limited)}`,
      phase: RUNTIME_THINKING_PHASES.investigator,
      limited: true,
      messageKey:
        "pages.assessmentFlow.technicalEvidence.investigatorLimitedSummary",
      params: { failed: String(limited.length) },
    });
  }
  return items;
}

function projectAuthoritativeRuntimeThinking(
  progress: AssessmentRuntimeEngineeringProgress,
): RuntimeThinkingItem[] {
  const items: RuntimeThinkingItem[] = [];
  items.push({
    id: `planner:${progress.planningBatchId}`,
    phase: RUNTIME_THINKING_PHASES.planner,
    limited: false,
    messageKey: progress.targeted
      ? "pages.assessmentFlow.technicalEvidence.plannerTargetedSummary"
      : "pages.assessmentFlow.technicalEvidence.plannerSummary",
    params: {
      selected: String(progress.planner.selectedCount),
      skipped: String(progress.planner.skippedCount),
      total: String(progress.planner.candidateCount),
    },
  });

  if (
    progress.investigator.completedCount > 0 ||
    progress.investigator.pendingCount > 0 ||
    progress.investigator.waitingForInputCount > 0
  ) {
    items.push({
      id: `investigator:${progress.planningBatchId}`,
      phase: RUNTIME_THINKING_PHASES.investigator,
      limited: false,
      messageKey: "pages.assessmentFlow.technicalEvidence.investigatorSummary",
      params: {
        investigated: String(progress.investigator.completedCount),
        selected: String(progress.investigator.selectedCount),
        pending: String(progress.investigator.pendingCount),
      },
    });
  }

  if (progress.investigator.domainLimitedCount > 0) {
    items.push({
      id: `investigator-limited:${progress.planningBatchId}`,
      phase: RUNTIME_THINKING_PHASES.investigator,
      limited: true,
      messageKey:
        "pages.assessmentFlow.technicalEvidence.investigatorLimitedSummary",
      params: { failed: String(progress.investigator.domainLimitedCount) },
    });
  }

  if (progress.investigator.runtimeFailedCount > 0) {
    items.push({
      id: `investigator-runtime-failed:${progress.planningBatchId}`,
      phase: RUNTIME_THINKING_PHASES.investigator,
      limited: true,
      messageKey:
        "pages.assessmentFlow.technicalEvidence.investigatorRuntimeFailedSummary",
      params: { failed: String(progress.investigator.runtimeFailedCount) },
    });
  }

  return items;
}

function latestEngineeringProgress(
  progress: AssessmentRuntimeEngineeringProgress[],
): AssessmentRuntimeEngineeringProgress | null {
  return progress[0] ?? null;
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
  return activityPhase(activity);
}

function activityPhase(
  activity: WorkspaceRuntimeActivityItem,
): RuntimeThinkingPhase | null {
  if (
    activity.toolName?.startsWith(
      ENGINEERING_RULE_ACTIVITY_TOOL_PREFIXES.planner,
    )
  ) {
    return RUNTIME_THINKING_PHASES.planner;
  }
  if (
    activity.toolName?.startsWith(
      ENGINEERING_RULE_ACTIVITY_TOOL_PREFIXES.investigator,
    )
  ) {
    return RUNTIME_THINKING_PHASES.investigator;
  }
  return null;
}

function latestByTool(
  activity: WorkspaceRuntimeActivityItem[],
): WorkspaceRuntimeActivityItem[] {
  const latest = new Map<string, WorkspaceRuntimeActivityItem>();
  for (const item of activity) {
    const key = item.toolName ?? item.eventId;
    const current = latest.get(key);
    if (!current || item.sequence > current.sequence) {
      latest.set(key, item);
    }
  }
  return [...latest.values()];
}

function newestEventId(activity: WorkspaceRuntimeActivityItem[]): string {
  return activity.reduce((newest, item) =>
    item.sequence > newest.sequence ? item : newest,
  ).eventId;
}

function isTargetedExactResumeDecision(
  activity: WorkspaceRuntimeActivityItem,
): boolean {
  const summary = summaryRecord(activity.outputSummary);
  const params = summaryRecord(summary?.messageParams ?? null);
  return (
    summary?.reasonCode ===
      ASSESSMENT_RUNTIME_PLAN_REASON_CODES.targetedExactResumePin ||
    params?.reasonCode ===
      ASSESSMENT_RUNTIME_PLAN_REASON_CODES.targetedExactResumePin
  );
}

function summaryRecord(
  value: WorkspaceRuntimeSummaryValue | null,
): Record<string, WorkspaceRuntimeSummaryValue> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
}
