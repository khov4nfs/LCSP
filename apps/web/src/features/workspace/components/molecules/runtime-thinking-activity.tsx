import { resolveMessage, type MessageKey } from "@lcsp/i18n";

import { appLocale } from "@/lib/locale";

import {
  RUNTIME_THINKING_PHASES,
  type RuntimeThinkingItem,
} from "../../types/workspace-runtime.types";
import { formatRuntimeThinkingItem } from "../../utils/runtime-thinking-projection";
import { AgentMessage, AgentTurn, ThoughtLine } from "./agent-turn";

export function RuntimeThinkingActivity({ item }: { item: RuntimeThinkingItem }) {
  return (
    <AgentTurn>
      <AgentMessage>
        <div className="space-y-2" data-runtime-thinking-id={item.id}>
          <ThoughtLine label={resolveMessage(appLocale, thinkingLabelKey(item))} />
          <p className="whitespace-pre-wrap break-words text-muted-foreground">
            {formatRuntimeThinkingItem(item)}
          </p>
        </div>
      </AgentMessage>
    </AgentTurn>
  );
}

function thinkingLabelKey(item: RuntimeThinkingItem): MessageKey {
  if (item.phase === RUNTIME_THINKING_PHASES.planner) {
    return item.limited
      ? "pages.assessmentFlow.technicalEvidence.plannerFailed"
      : "pages.assessmentFlow.technicalEvidence.plannerProgress";
  }
  return item.limited
    ? "pages.assessmentFlow.technicalEvidence.investigatorFailed"
    : "pages.assessmentFlow.technicalEvidence.investigatorProgress";
}
