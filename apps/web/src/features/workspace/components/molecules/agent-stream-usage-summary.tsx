import { resolveMessage } from "@lcsp/i18n";

import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";
import type { AgentStreamUsageSummaryProps } from "../../types/agent-stream-usage.types";
import { usageFooterParts } from "../../utils/agent-stream-usage";
import { AgentStreamUsageFooter } from "./agent-stream-usage-footer";

/** The same numeric presentation for a turn and the current runtime sidebar. */
export function AgentStreamUsageSummary({
  aggregate,
  titleKey,
  className,
}: AgentStreamUsageSummaryProps) {
  const { usage, partial } = aggregate;
  return (
    <section
      data-stream-usage-summary
      className={cn(
        "min-w-0 border-t border-border/60 pt-3 text-xs",
        className,
      )}
    >
      <h3 className="font-medium text-muted-foreground">
        {resolveMessage(appLocale, titleKey)}
      </h3>
      {usage?.totalTokens !== undefined ? (
        <p
          data-stream-usage-total
          className="mt-1 text-sm font-semibold tabular-nums text-foreground"
        >
          {usageFooterParts({ totalTokens: usage.totalTokens }).join(" · ")}
        </p>
      ) : null}
      <AgentStreamUsageFooter
        usage={
          usage && {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            details: usage.details,
          }
        }
        className="mt-1"
      />
      {!usage || partial ? (
        <p className="mt-1 text-muted-foreground">
          {resolveMessage(
            appLocale,
            usage
              ? "pages.appShell.agentStreamUsage.partial"
              : "pages.appShell.agentStreamUsage.unavailable",
          )}
        </p>
      ) : null}
    </section>
  );
}
