"use client";

import type { ReactNode } from "react";
import { RefreshCwIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const PANEL_STATES = {
  populated: "populated",
  empty: "empty",
  loading: "loading",
  error: "error",
  stale: "stale",
} as const;

export type PanelStateKind =
  (typeof PANEL_STATES)[keyof typeof PANEL_STATES];

type PanelStateProps = {
  state: PanelStateKind;
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  staleNotice?: string;
  children?: ReactNode;
  className?: string;
};

/**
 * Business purpose: Render standardized Populated, Empty, Loading, Error, and Stale panel states aligned to Figma 1681:1307..1338 (Data UI State Matrix 1685:3275).
 * Business rules:
 * - Loading renders accessible skeleton placeholders; Error renders a destructive alert with optional retry action; Empty renders a dashed Empty state.
 * - Stale keeps existing data visible beneath a semantic warning banner with optional refresh action, never hiding real records.
 * Execution flow:
 * 1. Branch on state (loading, error, empty, stale, populated).
 * 2. Render the corresponding shared UI primitive and optional action button.
 * Failure cases:
 * - Missing title/description or action callback renders cleanly without broken controls.
 * Side effects:
 * - Invokes onAction when retry/refresh is clicked.
 */
export function PanelState({
  state,
  title,
  description,
  actionLabel,
  onAction,
  staleNotice,
  children,
  className,
}: PanelStateProps) {
  if (state === PANEL_STATES.loading) {
    return (
      <div
        role="status"
        aria-label={title}
        className={cn("space-y-3", className)}
        data-component="PanelState"
        data-state="loading"
      >
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (state === PANEL_STATES.error) {
    return (
      <Alert
        variant="destructive"
        role="alert"
        className={className}
        data-component="PanelState"
        data-state="error"
      >
        {title ? <AlertTitle>{title}</AlertTitle> : null}
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>{description ?? title}</span>
          {onAction && actionLabel ? (
            <Button type="button" variant="outline" size="sm" onClick={onAction}>
              <RefreshCwIcon aria-hidden="true" data-icon="inline-start" />
              {actionLabel}
            </Button>
          ) : null}
        </AlertDescription>
      </Alert>
    );
  }

  if (state === PANEL_STATES.empty) {
    return (
      <Empty
        role="status"
        className={cn("rounded-xl border border-dashed", className)}
        data-component="PanelState"
        data-state="empty"
      >
        <EmptyHeader>
          {title ? <EmptyTitle>{title}</EmptyTitle> : null}
          {description ? (
            <EmptyDescription>{description}</EmptyDescription>
          ) : null}
        </EmptyHeader>
        {onAction && actionLabel ? (
          <Button type="button" variant="outline" size="sm" onClick={onAction}>
            {actionLabel}
          </Button>
        ) : null}
      </Empty>
    );
  }

  if (state === PANEL_STATES.stale) {
    return (
      <div
        className={cn("space-y-4", className)}
        data-component="PanelState"
        data-state="stale"
      >
        <Alert className="border-status-warning-border bg-status-warning-bg text-status-warning">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{staleNotice ?? description ?? title}</span>
            {onAction && actionLabel ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onAction}
              >
                <RefreshCwIcon aria-hidden="true" data-icon="inline-start" />
                {actionLabel}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
        {children}
      </div>
    );
  }

  return (
    <div
      className={className}
      data-component="PanelState"
      data-state="populated"
    >
      {children}
    </div>
  );
}
