import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { trackingMessage } from "../../utils/tracking-display";

/**
 * Business purpose: Render the action-first `Next request` spotlight banner matching Figma Frame 24 (`1682:2973`).
 * Business rules:
 * - Surfaces the highest-priority unresolved information request above the request table.
 * - Uses semantic attention/warning tokens without hardcoded hex values.
 * Execution flow:
 * 1. Render left semantic accent bar, `Next action` eyebrow, question/fact heading, and assessment context.
 * 2. Render primary `Answer request` action button invoking `onAnswer`.
 * Failure cases:
 * - None; omitted by parent when there are no open requests.
 * Side effects:
 * - Triggers `onAnswer()` when clicked.
 */
export function RequestCard({
  title,
  subtitle,
  onAnswer,
  className,
}: {
  title: string;
  subtitle: string;
  onAnswer: () => void;
  className?: string;
}) {
  return (
    <section
      aria-label={trackingMessage("requestsNextActionLabel")}
      className={cn(
        "relative flex flex-col justify-between gap-4 overflow-hidden rounded-2xl border border-status-warning-border bg-metric-attention-bg px-5 py-4 shadow-xs sm:flex-row sm:items-center",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="absolute top-3.5 left-0 h-10 w-1 rounded-r-xs bg-status-warning"
      />
      <div className="min-w-0 space-y-1 pl-2">
        <p className="text-xs font-medium text-metric-attention-value">
          {trackingMessage("requestsNextActionLabel")}
        </p>
        <h2 className="text-xl font-semibold tracking-tight text-metric-attention-ink">
          {title}
        </h2>
        <p className="truncate text-xs text-metric-attention-muted">
          {subtitle}
        </p>
      </div>

      <Button
        type="button"
        onClick={onAnswer}
        className="shrink-0 bg-status-warning text-primary-foreground hover:bg-status-warning/90"
      >
        {trackingMessage("nextActionAnswer")}
      </Button>
    </section>
  );
}
