"use client";

import React, { type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Figma Component: LCSP Data / Table row / events (#1682:1255)
 * 5 columns:
 * - C0: Assessment / event (#1682:1257)
 * - C1: Area (#1682:1258)
 * - Status: Figma Status Badge (#1681:1297..1303)
 * - C3: Updated (#1682:1259)
 * - C4: Next action (#1682:1260) with interactive link
 */
export type FigmaEventsTableRowProps = {
  c0Event: ReactNode;
  c1Area: ReactNode;
  statusBadge: ReactNode;
  c3Updated: ReactNode;
  c4NextActionLabel: string;
  nextActionHref?: string;
  onNextAction?: () => void;
  className?: string;
};

export function FigmaEventsTableRow({
  c0Event,
  c1Area,
  statusBadge,
  c3Updated,
  c4NextActionLabel,
  nextActionHref,
  onNextAction,
  className,
}: FigmaEventsTableRowProps) {
  const nextActionContent = (
    <span className="inline-flex items-center gap-1 font-medium text-[#11545B] hover:text-[#0b383d] transition-colors">
      <span>{c4NextActionLabel}</span>
      <span aria-hidden="true">›</span>
    </span>
  );

  return (
    <div
      data-figma-node="1682:1255"
      data-figma-name="LCSP Data / Table row / events"
      className={cn(
        "group relative flex min-h-[44px] items-center border-b border-[#D6DFE7] bg-white px-4 py-2.5 text-sm transition-colors hover:bg-slate-50/60",
        className
      )}
    >
      {/* C0: Assessment / event */}
      <div className="w-[280px] shrink-0 font-semibold text-[#101C29] truncate">
        {c0Event}
      </div>

      {/* C1: Area */}
      <div className="w-[180px] shrink-0 text-[#48586A] truncate">
        {c1Area}
      </div>

      {/* Status */}
      <div className="w-[160px] shrink-0">
        {statusBadge}
      </div>

      {/* C3: Updated */}
      <div className="w-[170px] shrink-0 text-[#48586A]">
        {c3Updated}
      </div>

      {/* C4: Next action */}
      <div className="flex-1 text-right">
        {nextActionHref ? (
          <Link
            href={nextActionHref}
            className="focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#11545B] rounded-xs"
          >
            {nextActionContent}
          </Link>
        ) : onNextAction ? (
          <button
            type="button"
            onClick={onNextAction}
            className="cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#11545B] rounded-xs"
          >
            {nextActionContent}
          </button>
        ) : (
          nextActionContent
        )}
      </div>
    </div>
  );
}

/**
 * Figma Component: LCSP shadcn / CardHeader (#1711:8840)
 */
export function FigmaAdminCardHeader({
  title,
  description,
  className,
  titleClassName,
  descriptionClassName,
  actionSlot,
}: {
  title: ReactNode;
  description?: ReactNode;
  className?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  actionSlot?: ReactNode;
}) {
  return (
    <div
      data-figma-node="1711:8840"
      data-figma-name="LCSP shadcn / CardHeader"
      className={cn("flex items-start justify-between gap-4", className)}
    >
      <div className="space-y-1 min-w-0">
        <h3
          className={cn(
            "font-semibold text-lg tracking-tight text-[#101C29]",
            titleClassName
          )}
        >
          {title}
        </h3>
        {description ? (
          <p
            className={cn(
              "text-sm text-[#48586A]",
              descriptionClassName
            )}
          >
            {description}
          </p>
        ) : null}
      </div>
      {actionSlot ? <div className="shrink-0">{actionSlot}</div> : null}
    </div>
  );
}

/**
 * Figma Component: LCSP Data / Status (#1681:1297..1303)
 */
export function FigmaAdminStatusBadge({
  label,
  variant = "info",
  className,
}: {
  label: ReactNode;
  variant?: "success" | "warning" | "danger" | "info";
  className?: string;
}) {
  const variantStyles = {
    success: "bg-[#F0FDF4] text-[#166534] border-[#BBF7D0]",
    warning: "bg-[#FFFBEB] text-[#92400E] border-[#FDE68A]",
    danger: "bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]",
    info: "bg-[#EEF2FF] text-[#4338CA] border-[#C7D2FE]",
  };

  return (
    <span
      data-figma-node="1681:1299"
      data-figma-name="LCSP Data / Status"
      className={cn(
        "inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-semibold",
        variantStyles[variant],
        className
      )}
    >
      {label}
    </span>
  );
}

