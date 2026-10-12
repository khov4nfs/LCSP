import { MetaFooter } from "@/components/atoms/meta-footer";
import { resolveMessage } from "@lcsp/i18n";
import { appLocale } from "@/lib/locale";

import type { StreamRowUsage } from "../../types/agent-stream-usage.types";
import { usageFooterParts } from "../../utils/agent-stream-usage";

export function AgentStreamUsageFooter({
  usage,
  className,
  shared = false,
}: {
  usage: StreamRowUsage | undefined;
  className?: string;
  shared?: boolean;
}) {
  return (
    <MetaFooter
      items={[
        ...usageFooterParts(usage),
        ...(shared
          ? [
              resolveMessage(
                appLocale,
                "pages.appShell.agentStreamUsage.shared",
              ),
            ]
          : []),
      ]}
      className={className}
    />
  );
}
