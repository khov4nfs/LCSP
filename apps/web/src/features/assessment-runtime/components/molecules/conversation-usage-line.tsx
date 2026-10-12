import { AgentStreamUsageFooter } from "@/features/workspace/components/molecules/agent-stream-usage-footer";
import type { UsageTotals } from "../../types/conversation.types";

/** One quiet usage line from canonical totals; renders nothing when no usage was reported. */
export function ConversationUsageLine({
  usage,
  className,
}: {
  usage: UsageTotals | null;
  className?: string;
}) {
  if (!usage) return null;
  return (
    <AgentStreamUsageFooter
      usage={{
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
      }}
      className={className}
    />
  );
}
