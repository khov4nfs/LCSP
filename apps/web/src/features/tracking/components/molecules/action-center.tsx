"use client";

import Link from "next/link";
import { AlertCircleIcon, ChevronRightIcon, TriangleAlertIcon } from "lucide-react";
import type {
  CustomerTrackingActionItem,
  CustomerTrackingAssessmentItem,
} from "@lcsp/contracts/assessment-domain";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { NextMetricCard } from "@/components/molecules/next-metric-card";
import { NEXT_METRIC_VARIANTS } from "@/components/types/dashboard-primitives.types";
import { appLocale } from "@/lib/locale";
import { TrackingEmptyState } from "./tracking-empty-state";
import { trackingMessage } from "../../utils/tracking-display";

type ActionCenterProps = {
  actions: readonly CustomerTrackingActionItem[];
  failedAssessments: readonly CustomerTrackingAssessmentItem[];
  openRequestsCount: number;
  reportsReadyCount: number;
};

/**
 * Business purpose:
 * Surface the customer's highest-priority pending input requests and failed assessments
 * alongside quick-jump summary metrics for open requests and ready reports.
 *
 * Business rules:
 * - Display at most 3 priority items (open action requests first, then failed/blocked assessments).
 * - Reconcile header counts and metric cards with actual tracking overview and reports totals.
 *
 * Execution flow:
 * 1. Merge open action items and failed assessments into a bounded 3-item queue.
 * 2. Render each item with severity marker, title, context, and direct link to its assessment.
 * 3. Render Open requests (attention) and Reports ready (ready) interactive metric cards.
 *
 * Failure cases:
 * - When no items require attention, render the localized empty state while keeping metric cards visible.
 *
 * Side effects:
 * - Pure presentational composition; navigation occurs via Next.js Link elements.
 */
export function ActionCenter({
  actions,
  failedAssessments,
  openRequestsCount,
  reportsReadyCount,
}: ActionCenterProps) {
  const queueItems = [
    ...actions.slice(0, 3).map((item) => ({
      id: `action-${item.requestId}`,
      title: item.unresolvedFact || item.question,
      subtitle: trackingMessage("actionCenterAnswerRequired").replace(
        "{name}",
        item.assessmentName,
      ),
      href: `/assessments/${encodeURIComponent(item.assessmentId)}?requestId=${encodeURIComponent(item.requestId)}`,
      severity: "warning" as const,
    })),
    ...failedAssessments.slice(0, Math.max(0, 3 - actions.length)).map((item) => ({
      id: `failed-${item.assessmentId}`,
      title: trackingMessage("actionCenterFailedTitle"),
      subtitle: trackingMessage("actionCenterReviewError").replace(
        "{name}",
        item.name,
      ),
      href: `/assessments/${encodeURIComponent(item.assessmentId)}`,
      severity: "error" as const,
    })),
  ].slice(0, 3);

  const subtitle = trackingMessage("actionCenterSubtitle")
    .replace("{open}", openRequestsCount.toLocaleString(appLocale))
    .replace("{failed}", failedAssessments.length.toLocaleString(appLocale));

  return (
    <Card
      className="relative flex h-full flex-col justify-between overflow-hidden rounded-2xl border-border bg-card shadow-xs"
      data-component="ActionCenter"
    >
      <span
        className="absolute top-4 left-0 h-10 w-1 rounded-r-xs bg-amber-600"
        aria-hidden="true"
      />
      <CardHeader className="pb-3 pl-5">
        <CardTitle className="text-lg font-semibold tracking-tight">
          {trackingMessage("actionCenterTitle")}
        </CardTitle>
        <CardDescription>{subtitle}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col justify-between gap-4 pt-0">
        {queueItems.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border border-t border-border">
            {queueItems.map((item) => {
              const isError = item.severity === "error";
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="group flex items-center gap-3 py-3 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span
                      className={
                        isError
                          ? "flex size-8 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"
                          : "flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                      }
                      aria-hidden="true"
                    >
                      {isError ? (
                        <AlertCircleIcon className="size-4" />
                      ) : (
                        <TriangleAlertIcon className="size-4" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-foreground group-hover:text-primary">
                        {item.title}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.subtitle}
                      </span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-brand-deep">
                      {trackingMessage("actionCenterView")}
                      <ChevronRightIcon className="size-3.5" aria-hidden="true" />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="border-t border-border pt-3">
            <TrackingEmptyState>{trackingMessage("noActions")}</TrackingEmptyState>
          </div>
        )}

        <div className="flex flex-col gap-2 pt-1">
          <NextMetricCard
            variant={NEXT_METRIC_VARIANTS.attention}
            label={trackingMessage("openRequestsMetricLabel")}
            context={trackingMessage("openRequestsMetricContext")}
            value={openRequestsCount.toLocaleString(appLocale)}
            href="/workspace/compliance"
          />
          <NextMetricCard
            variant={NEXT_METRIC_VARIANTS.ready}
            label={trackingMessage("reportsReadyMetricLabel")}
            context={trackingMessage("reportsReadyMetricContext")}
            value={reportsReadyCount.toLocaleString(appLocale)}
            href="/workspace/reports"
          />
        </div>
      </CardContent>
    </Card>
  );
}
