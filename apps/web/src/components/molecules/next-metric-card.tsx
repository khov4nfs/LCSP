"use client";

import Link from "next/link";
import { ArrowUpRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  NEXT_METRIC_VARIANTS,
  type NextMetricCardProps,
  type NextMetricVariant,
} from "../types/dashboard-primitives.types";

const VARIANT_STYLES: Record<
  NextMetricVariant,
  {
    container: string;
    label: string;
    value: string;
    context: string;
    arrow: string;
  }
> = {
  [NEXT_METRIC_VARIANTS.embedded]: {
    container: "bg-bento-card text-white",
    label: "text-bento-foreground text-xs font-semibold",
    value: "text-bento-heading text-3xl font-semibold tabular-nums leading-none",
    context: "text-bento-foreground text-xs",
    arrow: "text-bento-accent",
  },
  [NEXT_METRIC_VARIANTS.attention]: {
    container: "bg-metric-attention-bg text-metric-attention-ink",
    label: "text-metric-attention-ink text-sm font-semibold",
    value:
      "text-metric-attention-value text-2xl font-semibold tabular-nums leading-none",
    context: "text-metric-attention-muted text-xs",
    arrow: "text-metric-attention-value",
  },
  [NEXT_METRIC_VARIANTS.ready]: {
    container: "bg-metric-ready-bg text-metric-ready-ink",
    label: "text-metric-ready-ink text-sm font-semibold",
    value:
      "text-metric-ready-value text-2xl font-semibold tabular-nums leading-none",
    context: "text-metric-ready-muted text-xs",
    arrow: "text-metric-ready-value",
  },
};

/**
 * Shared metric card matching Figma masters 1826:13594 (Embedded analytics),
 * 1826:13600 (Needs attention), and 1826:13606 (Ready).
 * Renders a destination arrow ONLY when interactive (onAction or href is supplied).
 */
export function NextMetricCard({
  label,
  value,
  context,
  variant = NEXT_METRIC_VARIANTS.embedded,
  href,
  onAction,
  ariaLabel,
  className,
}: NextMetricCardProps) {
  const styles = VARIANT_STYLES[variant];
  const isInteractive = Boolean(href || onAction);
  const isEmbedded = variant === NEXT_METRIC_VARIANTS.embedded;

  const content = isEmbedded ? (
    <div className="flex h-full flex-col justify-between gap-2">
      <div className="flex items-start justify-between gap-2">
        <span className={cn("truncate", styles.label)}>{label}</span>
        {isInteractive ? (
          <ArrowUpRightIcon
            className={cn(
              "size-4 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none",
              styles.arrow,
            )}
            aria-hidden="true"
          />
        ) : null}
      </div>
      <div className="flex items-baseline gap-3">
        <p className={styles.value}>{value}</p>
        <span className={cn("min-w-0 flex-1 truncate", styles.context)}>
          {context}
        </span>
      </div>
    </div>
  ) : (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className={cn("truncate", styles.label)}>{label}</p>
        <p className={cn("mt-0.5 truncate", styles.context)}>{context}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className={styles.value}>{value}</span>
        {isInteractive ? (
          <ArrowUpRightIcon
            className={cn(
              "size-4 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none",
              styles.arrow,
            )}
            aria-hidden="true"
          />
        ) : null}
      </div>
    </div>
  );

  const sharedClassName = cn(
    "group block w-full rounded-lg text-left transition-colors duration-150 motion-reduce:transition-none",
    isEmbedded ? "min-h-23 p-3.5" : "px-3.5 py-2.5",
    isInteractive
      ? "cursor-pointer hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      : "",
    styles.container,
    className,
  );

  if (href) {
    return (
      <Link
        href={href}
        aria-label={ariaLabel ?? `${label}: ${value}`}
        className={sharedClassName}
        data-component="NextMetricCard"
        data-variant={variant}
      >
        {content}
      </Link>
    );
  }

  if (onAction) {
    return (
      <button
        type="button"
        onClick={onAction}
        aria-label={ariaLabel ?? `${label}: ${value}`}
        className={sharedClassName}
        data-component="NextMetricCard"
        data-variant={variant}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={sharedClassName}
      data-component="NextMetricCard"
      data-variant={variant}
    >
      {content}
    </div>
  );
}
