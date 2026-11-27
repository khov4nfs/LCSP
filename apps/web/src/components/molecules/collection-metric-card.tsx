"use client";

import { cn } from "@/lib/utils";

export const COLLECTION_METRIC_VARIANTS = {
  spotlight: "spotlight",
  indicator: "indicator",
} as const;

export const COLLECTION_METRIC_TONES = {
  primary: "primary",
  success: "success",
  warning: "warning",
  muted: "muted",
} as const;

export type CollectionMetricVariant =
  (typeof COLLECTION_METRIC_VARIANTS)[keyof typeof COLLECTION_METRIC_VARIANTS];

export type CollectionMetricTone =
  (typeof COLLECTION_METRIC_TONES)[keyof typeof COLLECTION_METRIC_TONES];

export type CollectionDistributionSegment = {
  key: string;
  count: number;
  toneClassName: string;
};

type CollectionMetricCardProps = {
  label: string;
  value: string | number;
  context: string;
  variant?: CollectionMetricVariant;
  tone?: CollectionMetricTone;
  segments?: readonly CollectionDistributionSegment[];
  isActive?: boolean;
  onClick?: () => void;
  className?: string;
};

const TONE_VALUE_CLASSES: Record<CollectionMetricTone, string> = {
  [COLLECTION_METRIC_TONES.primary]: "text-primary",
  [COLLECTION_METRIC_TONES.success]: "text-status-success",
  [COLLECTION_METRIC_TONES.warning]: "text-status-warning",
  [COLLECTION_METRIC_TONES.muted]: "text-muted-foreground",
};

/**
 * Business purpose: Render collection-level spotlight or status indicator KPI cards aligned to Figma masters 1839:13910 and 1839:13914.
 * Business rules:
 * - Spotlight variant uses the dark bento gradient and optional proportional distribution bar.
 * - Indicator variant uses card surface tokens and semantic tone colors, optionally acting as an interactive filter button.
 * Execution flow:
 * 1. Compute proportional widths for any supplied distribution segments.
 * 2. Render either a button (when onClick is supplied) or a static container with spotlight or indicator styling.
 * Failure cases:
 * - Zero total segment count omits bar fill without division-by-zero errors.
 * Side effects:
 * - Invokes onClick when interactive.
 */
export function CollectionMetricCard({
  label,
  value,
  context,
  variant = COLLECTION_METRIC_VARIANTS.indicator,
  tone = COLLECTION_METRIC_TONES.primary,
  segments,
  isActive = false,
  onClick,
  className,
}: CollectionMetricCardProps) {
  const isSpotlight = variant === COLLECTION_METRIC_VARIANTS.spotlight;
  const segmentTotal =
    segments?.reduce((sum, item) => sum + Math.max(0, item.count), 0) ?? 0;

  const inner = isSpotlight ? (
    <div className="flex h-full flex-col justify-between gap-2">
      <p className="truncate text-xs font-semibold text-bento-muted">{label}</p>
      <div className="flex items-baseline gap-3">
        <p className="text-3xl font-semibold leading-none text-white tabular-nums">
          {value}
        </p>
        <p className="min-w-0 flex-1 truncate text-xs text-bento-muted">
          {context}
        </p>
      </div>
      {segments && segments.length > 0 ? (
        <div
          className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-bento-border"
          aria-hidden="true"
        >
          {segmentTotal > 0
            ? segments.map((segment) =>
                segment.count > 0 ? (
                  <div
                    key={segment.key}
                    className={cn("h-full transition-all", segment.toneClassName)}
                    style={{
                      width: `${(segment.count / segmentTotal) * 100}%`,
                    }}
                  />
                ) : null,
              )
            : null}
        </div>
      ) : null}
    </div>
  ) : (
    <div className="flex h-full flex-col justify-between gap-1">
      <p className="truncate text-xs font-semibold text-foreground">{label}</p>
      <p
        className={cn(
          "text-3xl font-semibold leading-none tabular-nums",
          TONE_VALUE_CLASSES[tone],
        )}
      >
        {value}
      </p>
      <p className="truncate text-xs text-muted-foreground">{context}</p>
    </div>
  );

  const containerClasses = cn(
    "rounded-xl p-4 text-left transition-colors motion-reduce:transition-none",
    isSpotlight
      ? "bg-gradient-to-r from-bento-from to-bento-to text-white"
      : "border border-border bg-card text-card-foreground",
    onClick &&
      "cursor-pointer hover:border-primary/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
    isActive && !isSpotlight && "border-primary ring-2 ring-primary/20",
    className,
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={isActive}
        className={containerClasses}
        data-component="CollectionMetricCard"
      >
        {inner}
      </button>
    );
  }

  return (
    <div className={containerClasses} data-component="CollectionMetricCard">
      {inner}
    </div>
  );
}
