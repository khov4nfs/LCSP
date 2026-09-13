import { ASSESSMENT_RUNTIME_EVENT_TYPES } from "@lcsp/contracts/evidence";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";

import { appLocale } from "@/lib/locale";

import { ENGINEERING_RULE_ACTIVITY_TOOL_PREFIXES } from "../../config/runtime-activity";
import type { WorkspaceRuntimeActivityItem } from "../../types/workspace-runtime.types";
import { runtimeActivityDisplaySummary } from "../../utils/runtime-activity-summary";
import { AgentMessage, AgentTurn, ThoughtLine } from "./agent-turn";

export function RuntimeThinkingActivity({
  activity,
}: {
  activity: WorkspaceRuntimeActivityItem;
}) {
  return (
    <AgentTurn>
      <AgentMessage>
        <div className="space-y-2" data-runtime-event-id={activity.eventId}>
          <ThoughtLine label={runtimeActivityLabel(activity)} />
          <p className="whitespace-pre-wrap break-words text-muted-foreground">
            {runtimeActivityDisplaySummary(activity)}
          </p>
        </div>
      </AgentMessage>
    </AgentTurn>
  );
}

function runtimeActivityLabel(activity: WorkspaceRuntimeActivityItem): string {
  const labelKey = runtimeActivityLabelKey(activity);
  return resolveMessage(appLocale, labelKey);
}

function runtimeActivityLabelKey(
  activity: WorkspaceRuntimeActivityItem,
): MessageKey {
  if (
    activity.toolName?.startsWith(ENGINEERING_RULE_ACTIVITY_TOOL_PREFIXES.planner)
  ) {
    return activity.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolFailed
      ? "pages.assessmentFlow.technicalEvidence.plannerFailed"
      : "pages.assessmentFlow.technicalEvidence.plannerProgress";
  }
  if (
    activity.toolName?.startsWith(
      ENGINEERING_RULE_ACTIVITY_TOOL_PREFIXES.investigator,
    )
  ) {
    return activity.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolFailed
      ? "pages.assessmentFlow.technicalEvidence.investigatorFailed"
      : "pages.assessmentFlow.technicalEvidence.investigatorProgress";
  }
  return "pages.assessmentFlow.technicalEvidence.progress";
}
