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
    container: "bg-[#214752] text-white",
    label: "text-[#c6dfe1] text-xs font-semibold",
    value: "text-white text-3xl font-semibold tabular-nums leading-none",
    context: "text-[#c6dfe1] text-xs",
    arrow: "text-[#7ce0d3]",
  },
  [NEXT_METRIC_VARIANTS.attention]: {
    container:
      "bg-[#fff5e3] text-[#152736] dark:bg-amber-950/40 dark:text-amber-50",
    label: "text-[#152736] dark:text-amber-100 text-sm font-semibold",
    value:
      "text-[#92400e] dark:text-amber-300 text-2xl font-semibold tabular-nums leading-none",
    context: "text-[#48586a] dark:text-amber-200/80 text-xs",
    arrow: "text-[#92400e] dark:text-amber-300",
  },
  [NEXT_METRIC_VARIANTS.ready]: {
    container:
      "bg-[#e8f6f2] text-[#152736] dark:bg-emerald-950/40 dark:text-emerald-50",
    label: "text-[#152736] dark:text-emerald-100 text-sm font-semibold",
    value:
      "text-[#087f75] dark:text-emerald-300 text-2xl font-semibold tabular-nums leading-none",
    context: "text-[#48586a] dark:text-emerald-200/80 text-xs",
    arrow: "text-[#087f75] dark:text-emerald-300",
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
        <span className={styles.value}>{value}</span>
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
