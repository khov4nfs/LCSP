"use client";

import { cn } from "@/lib/utils";
import {
  DASHBOARD_SURFACES,
  type OutcomeLegendProps,
} from "../types/dashboard-primitives.types";

/**
 * Formats an integer/decimal percentage cleanly for EN/VI display without trailing ".0%".
 */
function formatOutcomePercentage(count: number, denominator: number): string {
  if (denominator <= 0 || count <= 0) return "0%";
  const raw = (count / denominator) * 100;
  const rounded = Math.round(raw * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

/**
 * Domain-neutral proportional legend aligned with Figma OutcomeLegend (1707:7702–7725).
 * Consumes normalized items and a denominator so multiple modules (workspace & compliance/admin) share one layout.
 */
export function OutcomeLegend({
  items,
  denominator,
  surface = DASHBOARD_SURFACES.dark,
  locale,
  className,
}: OutcomeLegendProps) {
  const isDark = surface === DASHBOARD_SURFACES.dark;

  return (
    <ul
      className={cn(
        "flex w-full flex-col divide-y",
        isDark ? "divide-bento-border" : "divide-border",
        className,
      )}
      data-component="OutcomeLegend"
    >
      {items.map((item) => {
        const ratio =
          denominator > 0
            ? Math.min(100, Math.max(0, (item.count / denominator) * 100))
            : 0;
        const pctLabel = formatOutcomePercentage(item.count, denominator);

        return (
          <li
            key={item.key}
            className="grid grid-cols-[minmax(0,1fr)_3.5rem_3rem_3.25rem] items-center gap-2 py-2 first:pt-0 last:pb-0 sm:gap-3"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-xs"
                style={{ backgroundColor: item.color }}
                aria-hidden="true"
              />
              <span
                className={cn(
                  "truncate text-xs font-medium sm:text-sm",
                  isDark ? "text-bento-foreground" : "text-foreground",
                )}
              >
                {item.label}
              </span>
            </div>

            <div
              className={cn(
                "h-1.5 w-full overflow-hidden rounded-full",
                isDark ? "bg-bento-border" : "bg-muted",
              )}
              aria-hidden="true"
            >
              <div
                className="h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
                style={{
                  width: `${ratio}%`,
                  backgroundColor: item.color,
                }}
              />
            </div>

            <span
              className={cn(
                "text-right text-xs font-semibold tabular-nums sm:text-sm",
                isDark ? "text-bento-foreground" : "text-foreground",
              )}
            >
              {item.count.toLocaleString(locale)}
            </span>

            <span
              className={cn(
                "text-right text-xs tabular-nums sm:text-sm",
                isDark ? "text-bento-foreground" : "text-muted-foreground",
              )}
            >
              {pctLabel}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
