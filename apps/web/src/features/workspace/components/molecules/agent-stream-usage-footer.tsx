import { MetaFooter } from "@/components/atoms/meta-footer";

import type { StreamRowUsage } from "../../types/agent-stream-usage.types";
import { usageFooterParts } from "../../utils/agent-stream-usage";

export function AgentStreamUsageFooter({
  usage,
  className,
}: {
  usage: StreamRowUsage | undefined;
  className?: string;
}) {
  return (
    <MetaFooter
      items={usageFooterParts(usage)}
      className={className}
    />
  );
}
