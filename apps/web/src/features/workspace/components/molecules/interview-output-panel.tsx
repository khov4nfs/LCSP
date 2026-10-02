import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A compact, customer-facing panel for an internal Interview processing
 * result (confirmed/adjusted context, handoff status) — distinct from a
 * chat message so it doesn't read as something the agent is "saying".
 */
export function InterviewOutputPanel({
  icon: Icon,
  label,
  className,
}: {
  icon: LucideIcon;
  label: string;
  className?: string;
}) {
  return (
    <div
      data-slot="interview-output-panel"
      className={cn(
        "flex items-center gap-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-sm text-foreground",
        className,
      )}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p className="min-w-0">{label}</p>
    </div>
  );
}
