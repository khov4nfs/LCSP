import { CheckCircle2Icon, HelpCircleIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Business purpose: Render the canonical Figma status badge (`LCSP Data / Status / warning` `1681:1299` and `Success`) for an information request.
 * Business rules:
 * - Open/unresolved requests use semantic warning tokens (`Needs information`).
 * - Answered/resolved requests use semantic success tokens (`Completed`).
 * Execution flow:
 * 1. Select warning or success semantic classes and icon from `open`.
 * 2. Resolve localized label via `resolveAppMessage`.
 * Failure cases:
 * - None; defaults to resolved styling when `open` is false.
 * Side effects:
 * - Pure presentational component shared across M05 (Information requests) and M06 (Assessment conversation).
 */
export function RequestStatusBadge({
  open,
  labelOverride,
  className,
}: {
  open: boolean;
  labelOverride?: string;
  className?: string;
}) {
  const label =
    labelOverride ??
    resolveAppMessage(
      open
        ? "pages.workspace.tracking.statusNeedsInfo"
        : "pages.workspace.tracking.statusCompleted",
    );

  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 font-medium",
        open
          ? "border-status-warning-border bg-status-warning-bg text-status-warning"
          : "border-status-success-border bg-status-success-bg text-status-success",
        className,
      )}
    >
      {open ? (
        <HelpCircleIcon className="size-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <CheckCircle2Icon className="size-3.5 shrink-0" aria-hidden="true" />
      )}
      <span>{label}</span>
    </Badge>
  );
}
