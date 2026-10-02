import { resolveMessage, type MessageKey } from "@lcsp/i18n";

import { appLocale } from "@/lib/locale";

import type { RuntimeThinkingItem } from "../../types/workspace-runtime.types";
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
  return item.limited
    ? "pages.assessmentFlow.technicalEvidence.ruleAnalysisLimited"
    : "pages.assessmentFlow.technicalEvidence.ruleAnalysisProgress";
}
