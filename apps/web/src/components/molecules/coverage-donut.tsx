"use client";

import { cn } from "@/lib/utils";
import {
  DASHBOARD_SURFACES,
  type CoverageDonutProps,
} from "../types/dashboard-primitives.types";

/**
 * Domain-neutral proportional donut chart aligned with Figma CoverageDonut (1707:7693).
 * Renders SVG arc segments when total > 0 and falls back to a neutral track ring when empty.
 */
export function CoverageDonut({
  segments,
  total,
  centerValue,
  centerLabel,
  size = 176,
  strokeWidth = 22,
  surface = DASHBOARD_SURFACES.dark,
  ariaLabel,
  className,
}: CoverageDonutProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  // Precompute cumulative arc offsets so every segment starts cleanly where the previous ended.
  const arcs = segments.reduce<
    Array<{
      key: string;
      label: string;
      color: string;
      dashLength: number;
      dashOffset: number;
    }>
  >((acc, segment) => {
    if (total <= 0 || segment.count <= 0) {
      return acc;
    }
    const previousLength = acc.reduce((sum, item) => sum + item.dashLength, 0);
    const ratio = Math.min(1, segment.count / total);
    const dashLength = ratio * circumference;
    acc.push({
      key: segment.key,
      label: segment.label,
      color: segment.color,
      dashLength,
      dashOffset: -previousLength,
    });
    return acc;
  }, []);

  const isDark = surface === DASHBOARD_SURFACES.dark;

  return (
    <div
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center",
        className,
      )}
      style={{ width: size, height: size }}
      role="img"
      aria-label={ariaLabel ?? `${centerValue} ${centerLabel}`}
      data-component="CoverageDonut"
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden="true"
      >
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={isDark ? "#365862" : "currentColor"}
          strokeWidth={strokeWidth}
          className={isDark ? undefined : "text-muted"}
        />
        {arcs.map((arc) => (
          <circle
            key={arc.key}
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={arc.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${arc.dashLength} ${circumference}`}
            strokeDashoffset={arc.dashOffset}
            strokeLinecap="butt"
            className="transition-[stroke-dasharray,stroke-dashoffset] duration-300 motion-reduce:transition-none"
          />
        ))}
      </svg>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
        <span
          className={cn(
            "text-3xl leading-none font-semibold tabular-nums tracking-tight",
            isDark ? "text-[#f3fdfc]" : "text-foreground",
          )}
        >
          {centerValue}
        </span>
        <span
          className={cn(
            "mt-1 text-xs leading-tight",
            isDark ? "text-[#c9e2e6]" : "text-muted-foreground",
          )}
        >
          {centerLabel}
        </span>
      </div>
    </div>
  );
}
