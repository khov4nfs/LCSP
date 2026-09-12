import type { MessageKey } from "@lcsp/i18n";
import type { AdminOverviewActivityPoint } from "@lcsp/contracts/auth";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type AdminAssessmentActivityCardProps = {
  points?: AdminOverviewActivityPoint[];
  totalCompleted?: number;
  periodDays?: number;
  startDate?: string;
  endDate?: string;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  className?: string;
};

function formatShortDate(isoString?: string): string {
  if (!isoString) return "";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}/${day}`;
}

export function AdminAssessmentActivityCard({
  points = [],
  totalCompleted = 0,
  periodDays = 30,
  startDate,
  endDate,
  isLoading = false,
  isError = false,
  onRetry,
  className,
}: AdminAssessmentActivityCardProps) {
  const title = resolveAppMessage(
    "pages.admin.overview.assessmentActivity.title" as MessageKey,
  );
  const subtitleTemplate = resolveAppMessage(
    "pages.admin.overview.assessmentActivity.subtitle" as MessageKey,
  );
  const subtitle = subtitleTemplate.replace("{days}", String(periodDays));
  const completedLabel = resolveAppMessage(
    "pages.admin.overview.assessmentActivity.completed" as MessageKey,
  );

  if (isLoading) {
    return (
      <div
        className={cn(
          "flex min-h-72 w-full flex-col justify-between rounded-xl border border-border bg-card p-5 shadow-xs",
          className,
        )}
      >
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3.5 w-56" />
          </div>
          <div className="flex flex-col items-end space-y-1">
            <Skeleton className="h-6 w-12" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
        <div className="flex h-32 items-end justify-between gap-2 px-2">
          {Array.from({ length: 14 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-5 rounded-xs" />
          ))}
        </div>
        <div className="flex justify-between">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-12" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className={cn(
          "flex min-h-72 w-full flex-col items-center justify-center rounded-xl border border-border bg-card p-5 text-center shadow-xs",
          className,
        )}
      >
        <p className="text-sm font-semibold text-foreground">
          {resolveAppMessage(
            "pages.admin.overview.assessmentActivity.errorTitle" as MessageKey,
          )}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {resolveAppMessage(
            "pages.admin.overview.assessmentActivity.errorDescription" as MessageKey,
          )}
        </p>
        {onRetry ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="mt-4"
          >
            {resolveAppMessage("pages.admin.overview.retry" as MessageKey)}
          </Button>
        ) : null}
      </div>
    );
  }

  const maxCount = Math.max(
    1,
    ...points.map((p) => Math.max(p.startedCount, p.completedCount)),
  );

  const startLabel = startDate ? formatShortDate(startDate) : (points[0] ? formatShortDate(points[0].timestamp) : "");
  const endLabel = endDate ? formatShortDate(endDate) : (points[points.length - 1] ? formatShortDate(points[points.length - 1].timestamp) : "");

  return (
    <div
      className={cn(
        "flex min-h-72 w-full flex-col justify-between rounded-xl border border-border bg-card p-5 shadow-xs",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
        <div className="text-right">
          <span className="text-lg font-semibold text-foreground">
            {totalCompleted.toLocaleString()}
          </span>
          <p className="text-xs text-muted-foreground">{completedLabel}</p>
        </div>
      </div>

      {/* Chart visualization */}
      {points.length === 0 ? (
        <div className="flex h-32 flex-col items-center justify-center text-center">
          <p className="text-xs font-medium text-foreground">
            {resolveAppMessage(
              "pages.admin.overview.assessmentActivity.emptyTitle" as MessageKey,
            )}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {resolveAppMessage(
              "pages.admin.overview.assessmentActivity.emptyDescription" as MessageKey,
            )}
          </p>
        </div>
      ) : (
        <div className="relative flex h-32 flex-col justify-end">
          {/* Horizontal grid lines */}
          <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
            <div className="h-px w-full bg-border/40" />
            <div className="h-px w-full bg-border/40" />
            <div className="h-px w-full bg-border/40" />
            <div className="h-px w-full bg-border/40" />
          </div>

          {/* Bar elements */}
          <div className="relative z-10 flex h-28 items-end justify-between gap-1.5 px-1">
            {points.map((point, index) => {
              const heightPercent = Math.max(
                6,
                Math.round((point.startedCount / maxCount) * 100),
              );
              const pointDateLabel = formatShortDate(point.timestamp);
              const tooltipTemplate = resolveAppMessage(
                "pages.admin.overview.assessmentActivity.barTooltip" as MessageKey,
              );
              const tooltipText = tooltipTemplate
                .replace("{date}", pointDateLabel)
                .replace("{started}", String(point.startedCount))
                .replace("{completed}", String(point.completedCount));

              return (
                <Tooltip key={index}>
                  <TooltipTrigger
                    className="group flex flex-1 flex-col items-center justify-end h-full cursor-default focus:outline-hidden"
                    aria-label={tooltipText}
                  >
                    <div
                      style={{ height: `${heightPercent}%` }}
                      className="w-full max-w-[22px] rounded-xs bg-foreground/80 transition-all duration-150 group-hover:bg-foreground group-focus:bg-foreground"
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    <p className="font-medium">{pointDateLabel}</p>
                    <p className="text-muted-foreground text-xs">
                      {point.startedCount} {resolveAppMessage("pages.admin.overview.accountStatus.active" as MessageKey)} · {point.completedCount} {completedLabel}
                    </p>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer date labels */}
      <div className="flex justify-between text-xs text-muted-foreground pt-1 border-t border-border/20">
        <span>{startLabel}</span>
        <span>{endLabel}</span>
      </div>
    </div>
  );
}
