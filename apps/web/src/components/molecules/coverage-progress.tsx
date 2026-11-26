"use client";

import { cn } from "@/lib/utils";

type CoverageProgressProps = {
  concluded: number;
  total: number;
  locale?: string;
  barColor?: string;
  className?: string;
  stacked?: boolean;
};

/**
 * Shared coverage ratio + proportional progress bar (Figma 1836:13715 & 1777:13204).
 * Consumed by both Dashboard RecentAssessments and Assessments List AssessmentRow.
 */
export function CoverageProgress({
  concluded,
  total,
  locale,
  barColor = "var(--status-completed)",
  className,
  stacked = false,
}: CoverageProgressProps) {
  const ratio = total > 0 ? Math.min(100, Math.max(0, (concluded / total) * 100)) : 0;

  return (
    <div
      className={cn(
        stacked
          ? "flex flex-col gap-1.5"
          : "flex items-center gap-2.5",
        className,
      )}
      data-component="CoverageProgress"
    >
      <span className="min-w-12 text-xs font-medium text-muted-foreground tabular-nums">
        {concluded.toLocaleString(locale)} / {total.toLocaleString(locale)}
      </span>
      <div
        className={cn(
          "h-1.5 overflow-hidden rounded-full bg-muted",
          stacked ? "w-22" : "w-16",
        )}
        aria-hidden="true"
      >
        <div
          className="h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${ratio}%`, backgroundColor: barColor }}
        />
      </div>
    </div>
  );
}
