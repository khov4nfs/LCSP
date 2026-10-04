import {
  CheckCircle2,
  CircleDashed,
  LoaderCircle,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { AgentStreamUsageFooter } from "./agent-stream-usage-footer";

import type { AgentStreamActivityLogProps } from "../../types/agent-stream-activity-log.types";
import { projectAgentStreamActivityLog } from "../../utils/agent-stream-activity-log";
import {
  AGENT_STREAM_RUN_OUTCOMES,
  STREAM_ROW_STATUSES,
} from "../../utils/agent-stream-projection";

/** Compact customer-facing activity log: one live row per activity kind. */
export function AgentStreamActivityLog({
  events,
  outcomeOverride,
}: AgentStreamActivityLogProps) {
  const rows = projectAgentStreamActivityLog(events).map((row) =>
    row.status === STREAM_ROW_STATUSES.running &&
    outcomeOverride !== undefined &&
    outcomeOverride !== AGENT_STREAM_RUN_OUTCOMES.running
      ? { ...row, status: STREAM_ROW_STATUSES.neutral }
      : row,
  );
  if (rows.length === 0) return null;
  return (
    <ul data-stream-activity-log className="mt-3 min-w-0 space-y-1 text-xs">
      {rows.map((row) => (
        <li
          key={row.key}
          data-stream-activity-log-row={row.key}
          data-stream-status={row.status}
          className="min-w-0"
        >
          <div className="flex min-w-0 items-center gap-2">
            {row.status === STREAM_ROW_STATUSES.running ? (
              <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
            ) : row.failed ? (
              <XCircle className="size-3.5 shrink-0 text-destructive" />
            ) : row.status === STREAM_ROW_STATUSES.neutral ? (
              <CircleDashed className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
            )}
            <span
              className={cn(
                "shrink-0 font-medium text-foreground",
                row.failed && "text-destructive",
              )}
            >
              {row.label}
            </span>
            {row.target ? (
              <span
                data-stream-target
                className="min-w-0 truncate font-mono text-muted-foreground"
              >
                {row.target}
              </span>
            ) : null}
            {row.count > 1 ? (
              <span
                data-stream-repeat-count={row.count}
                className="ml-auto shrink-0 rounded-full bg-muted px-1.5 font-mono text-muted-foreground"
              >
                ×{row.count}
              </span>
            ) : null}
          </div>
          <AgentStreamUsageFooter
            usage={row.usage}
            shared={row.sharedUsage}
            className="pl-5.5"
          />
        </li>
      ))}
    </ul>
  );
}
