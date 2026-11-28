"use client";

import type { MessageKey } from "@lcsp/i18n";
import type { AdminOverviewActivityPoint } from "@lcsp/contracts/auth";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NextMetricCard } from "@/components/molecules/next-metric-card";
import { NEXT_METRIC_VARIANTS } from "@/components/types/dashboard-primitives.types";
import { formatAppMessage, resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type AdminAssessmentActivityCardProps = {
  points?: AdminOverviewActivityPoint[];
  totalCompleted?: number;
  totalStarted?: number;
  totalUsersCount?: number;
  periodDays?: number;
  startDate?: string;
  endDate?: string;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  className?: string;
};

export function AdminAssessmentActivityCard({
  points = [],
  totalCompleted = 0,
  totalStarted = 0,
  totalUsersCount = 0,
  periodDays = 30,
  isLoading = false,
  isError = false,
  onRetry,
  className,
}: AdminAssessmentActivityCardProps) {
  const title = resolveAppMessage(
    "pages.admin.overview.assessmentActivity.title" as MessageKey,
  );
  const subtitle = formatAppMessage(
    "pages.admin.overview.assessmentActivity.subtitle" as MessageKey,
    { days: periodDays },
  );

  if (isLoading) {
    return (
      <div
        className={cn(
          "flex min-h-95 w-full flex-col justify-between rounded-2xl bg-[#0A2231] p-6 text-white shadow-md",
          className,
        )}
      >
        <div className="space-y-1">
          <Skeleton className="h-6 w-48 bg-white/20" />
          <Skeleton className="h-4 w-72 bg-white/10" />
        </div>
        <div className="flex h-40 items-end justify-between gap-3 px-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-8 rounded-xs bg-white/20" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-white/10">
          <Skeleton className="h-16 w-full bg-white/10" />
          <Skeleton className="h-16 w-full bg-white/10" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className={cn(
          "flex min-h-95 w-full flex-col items-center justify-center rounded-2xl bg-[#0A2231] p-6 text-center text-white shadow-md",
          className,
        )}
      >
        <p className="text-base font-semibold">
          {resolveAppMessage(
            "pages.admin.overview.assessmentActivity.errorTitle" as MessageKey,
          )}
        </p>
        <p className="mt-1 text-xs text-[#B7D6DA]">
          {resolveAppMessage(
            "pages.admin.overview.assessmentActivity.errorDescription" as MessageKey,
          )}
        </p>
        {onRetry ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="mt-4 border-white/20 bg-transparent text-white hover:bg-white/10"
          >
            {resolveAppMessage("pages.admin.overview.retry" as MessageKey)}
          </Button>
        ) : null}
      </div>
    );
  }

  // Derive max count across started and completed for proportional bar height
  const maxActivityCount = Math.max(
    ...points.map((point) =>
      Math.max(point.startedCount, point.completedCount),
    ),
    100,
  );

  return (
    <div
      data-figma-node="1682:1714"
      data-figma-name="Assessment throughput"
      className={cn(
        "flex flex-col justify-between rounded-2xl p-6 text-white shadow-md",
        className,
      )}
      style={{
        background:
          "linear-gradient(90deg, rgba(10, 34, 49, 1) 0%, rgba(22, 76, 80, 1) 100%)",
      }}
    >
      <div>
        {/* Header (#1711:9362) */}
        <div>
          <h3 className="text-xl font-bold tracking-tight text-[#F7FBFC]">
            {title}
          </h3>
          <p className="text-xs text-[#B7D6DA] mt-0.5">{subtitle}</p>
        </div>

        {/* Legend */}
        <div className="mt-4 flex items-center gap-6 text-xs text-[#C6DFE1]">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-xs bg-[#46D5B5]" />
            <span>
              {resolveAppMessage(
                "pages.admin.overview.assessmentActivity.started" as MessageKey,
              )}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-xs bg-[#A5B4FC]" />
            <span>
              {resolveAppMessage(
                "pages.admin.overview.assessmentActivity.completed" as MessageKey,
              )}
            </span>
          </div>
        </div>

        {/* Chart representation */}
        <div className="mt-6 flex h-40 items-end justify-between gap-4 px-2 pb-2 border-b border-[#365862]">
          {/* Why: An empty cohort is a real result; sample bars would misstate activity.
              How: Render only the bounded points returned by the Admin API.
              Invariant: Zero totals never create fictional chart data. */}
          {points.slice(-4).map((item, index) => {
            const startedHeight = Math.min(
              100,
              Math.max(15, (item.startedCount / maxActivityCount) * 100),
            );
            const completedHeight = Math.min(
              100,
              Math.max(15, (item.completedCount / maxActivityCount) * 100),
            );
            const barLabel = formatAppMessage(
              "pages.admin.overview.assessmentActivity.barTooltip" as MessageKey,
              {
                date: item.date,
                started: item.startedCount,
                completed: item.completedCount,
              },
            );
            return (
              <div
                key={index}
                className="flex flex-1 flex-col items-center justify-end h-full gap-1.5"
              >
                <div className="flex items-end gap-1.5 w-full justify-center h-full">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <div
                          tabIndex={0}
                          aria-label={barLabel}
                          style={{ height: `${startedHeight}%` }}
                          className="w-5 rounded-t-xs bg-[#46D5B5] transition-all"
                        />
                      }
                    />
                    <TooltipContent>{barLabel}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <div
                          tabIndex={0}
                          aria-label={barLabel}
                          style={{ height: `${completedHeight}%` }}
                          className="w-5 rounded-t-xs bg-[#A5B4FC] transition-all"
                        />
                      }
                    />
                    <TooltipContent>{barLabel}</TooltipContent>
                  </Tooltip>
                </div>
                <span className="text-[11px] text-[#C6DFE1] truncate">
                  {item.date}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Embedded Analytics KPIs (#1832:13715) */}
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-[#40616A]">
        <NextMetricCard
          label={resolveAppMessage(
            "pages.admin.overview.assessmentActivity.userAccounts" as MessageKey,
          )}
          value={totalUsersCount}
          context={resolveAppMessage(
            "pages.admin.overview.assessmentActivity.userAccountsContext" as MessageKey,
          )}
          variant={NEXT_METRIC_VARIANTS.embedded}
          href="/admin/users"
        />
        <NextMetricCard
          label={resolveAppMessage(
            "pages.admin.overview.assessmentActivity.assessmentsStarted" as MessageKey,
          )}
          value={totalStarted}
          context={formatAppMessage(
            "pages.admin.overview.assessmentActivity.completedInCohort" as MessageKey,
            { count: totalCompleted },
          )}
          variant={NEXT_METRIC_VARIANTS.embedded}
          href="/admin/overview"
        />
      </div>
    </div>
  );
}
