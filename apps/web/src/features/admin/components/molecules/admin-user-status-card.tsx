import type { MessageKey } from "@lcsp/i18n";
import type { AdminOverviewAccountDistribution } from "@lcsp/contracts/auth";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type AdminUserStatusCardProps = {
  distribution?: AdminOverviewAccountDistribution | null;
  isLoading?: boolean;
  className?: string;
};

export function AdminUserStatusCard({
  distribution,
  isLoading = false,
  className,
}: AdminUserStatusCardProps) {
  const title = resolveAppMessage(
    "pages.admin.overview.accountStatus.title" as MessageKey,
  );
  const subtitle = resolveAppMessage(
    "pages.admin.overview.accountStatus.subtitle" as MessageKey,
  );
  const activeLabel = resolveAppMessage(
    "pages.admin.overview.accountStatus.active" as MessageKey,
  );
  const invitedLabel = resolveAppMessage(
    "pages.admin.overview.accountStatus.invited" as MessageKey,
  );
  const suspendedLabel = resolveAppMessage(
    "pages.admin.overview.accountStatus.suspended" as MessageKey,
  );
  const totalTemplate = resolveAppMessage(
    "pages.admin.overview.accountStatus.totalAccounts" as MessageKey,
  );

  if (isLoading) {
    return (
      <div
        className={cn(
          "flex min-h-72 w-full flex-col justify-between rounded-xl border border-border bg-card p-5 shadow-xs",
          className,
        )}
      >
        <div className="space-y-1">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3.5 w-48" />
        </div>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <Skeleton className="h-3.5 w-16" />
              <Skeleton className="h-3.5 w-10" />
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <Skeleton className="h-3.5 w-16" />
              <Skeleton className="h-3.5 w-10" />
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <Skeleton className="h-3.5 w-16" />
              <Skeleton className="h-3.5 w-10" />
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
          </div>
        </div>
        <Skeleton className="h-3.5 w-32" />
      </div>
    );
  }

  const activeCount = distribution?.activeCount ?? 0;
  const invitedCount = distribution?.invitedCount ?? 0;
  const suspendedCount = distribution?.suspendedCount ?? 0;
  const totalCount = distribution?.totalCount ?? 0;

  const activePercent =
    totalCount > 0 ? Math.min(100, (activeCount / totalCount) * 100) : 0;
  const invitedPercent =
    totalCount > 0 ? Math.min(100, (invitedCount / totalCount) * 100) : 0;
  const suspendedPercent =
    totalCount > 0 ? Math.min(100, (suspendedCount / totalCount) * 100) : 0;

  const totalText = distribution
    ? totalTemplate.replace("{count}", totalCount.toLocaleString())
    : "—";

  const rows = [
    { label: activeLabel, count: activeCount, percent: activePercent },
    { label: invitedLabel, count: invitedCount, percent: invitedPercent },
    { label: suspendedLabel, count: suspendedCount, percent: suspendedPercent },
  ];

  return (
    <div
      className={cn(
        "flex min-h-72 w-full flex-col justify-between rounded-xl border border-border bg-card p-5 shadow-xs",
        className,
      )}
    >
      {/* Header */}
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
      </div>

      {/* Rows */}
      <div className="space-y-3.5 py-1">
        {rows.map((row) => (
          <div key={row.label} className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">{row.label}</span>
              <span className="font-semibold text-foreground">
                {distribution ? row.count.toLocaleString() : "—"}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-sm bg-muted">
              <div
                style={{ width: `${row.percent}%` }}
                className="h-full rounded-sm bg-foreground/80 transition-all duration-300"
              />
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="border-t border-border/20 pt-2">
        <span className="text-xs text-muted-foreground">{totalText}</span>
      </div>
    </div>
  );
}
