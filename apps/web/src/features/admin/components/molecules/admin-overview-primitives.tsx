"use client";

import React, { type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Figma Component: LCSP Data / Table row / events (#1682:1255)
 * 5 columns:
 * - event: Assessment / event (#1682:1257)
 * - area: Area (#1682:1258)
 * - statusBadge: Figma Status Badge (#1681:1297..1303)
 * - updated: Updated timestamp (#1682:1259)
 * - nextActionLabel: Next action label (#1682:1260) with interactive link
 */
export type AdminEventsTableRowProps = {
  event: ReactNode;
  area: ReactNode;
  statusBadge: ReactNode;
  updated: ReactNode;
  nextActionLabel: string;
  nextActionHref?: string;
  onNextAction?: () => void;
  className?: string;
};

export function AdminEventsTableRow({
  event,
  area,
  statusBadge,
  updated,
  nextActionLabel,
  nextActionHref,
  onNextAction,
  className,
}: AdminEventsTableRowProps) {
  const nextActionContent = (
    <span className="inline-flex items-center gap-1 font-medium text-primary transition-colors hover:text-primary/80">
      <span>{nextActionLabel}</span>
      <span aria-hidden="true">›</span>
    </span>
  );

  return (
    <div
      data-figma-node="1682:1255"
      data-figma-name="LCSP Data / Table row / events"
      className={cn(
        "group relative flex min-h-11 items-center border-b border-border bg-card px-4 py-2.5 text-sm transition-colors hover:bg-muted/40",
        className
      )}
    >
      {/* Assessment / event */}
      <div className="w-70 shrink-0 truncate font-semibold text-foreground">
        {event}
      </div>

      {/* Area */}
      <div className="w-45 shrink-0 truncate text-muted-foreground">
        {area}
      </div>

      {/* Status */}
      <div className="w-40 shrink-0">
        {statusBadge}
      </div>

      {/* Updated */}
      <div className="w-42.5 shrink-0 text-muted-foreground">
        {updated}
      </div>

      {/* Next action */}
      <div className="flex-1 text-right">
        {nextActionHref ? (
          <Link
            href={nextActionHref}
            className="rounded-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            {nextActionContent}
          </Link>
        ) : onNextAction ? (
          <button
            type="button"
            onClick={onNextAction}
            className="cursor-pointer rounded-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
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
 * LCSP CardHeader molecule with title, optional description, and actionSlot
 */
export function AdminSectionCardHeader({
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
 * LCSP Status Badge for administrative event logs
 */
export function AdminStatusBadge({
  label,
  variant = "info",
  className,
}: {
  label: ReactNode;
  variant?: "success" | "warning" | "danger" | "info";
  className?: string;
}) {
  const variantStyles = {
    success:
      "border-status-success-border bg-status-success-bg text-status-success",
    warning:
      "border-status-warning-border bg-status-warning-bg text-status-warning",
    danger:
      "border-status-danger-border bg-status-danger-bg text-status-danger",
    info: "border-status-info-border bg-status-info-bg text-status-info",
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

