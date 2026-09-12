import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type AdminOverviewMetricCardProps = {
  label: string;
  value: string | number | null | undefined;
  subtitle: string;
  isLoading?: boolean;
  className?: string;
};

export function AdminOverviewMetricCard({
  label,
  value,
  subtitle,
  isLoading = false,
  className,
}: AdminOverviewMetricCardProps) {
  if (isLoading) {
    return (
      <div
        className={cn(
          "flex min-h-28 w-full flex-col justify-between rounded-xl border border-border bg-card p-4 shadow-xs",
          className,
        )}
      >
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-3.5 w-32" />
      </div>
    );
  }

  const displayValue =
    value === null || value === undefined
      ? "—"
      : typeof value === "number"
        ? value.toLocaleString()
        : value;

  return (
    <div
      className={cn(
        "flex min-h-28 w-full flex-col justify-between rounded-xl border border-border bg-card p-4 shadow-xs",
        className,
      )}
    >
      <span className="text-xs font-medium text-muted-foreground truncate">
        {label}
      </span>
      <span className="text-2xl font-semibold tracking-tight text-foreground truncate">
        {displayValue}
      </span>
      <span className="text-xs text-muted-foreground truncate">
        {subtitle}
      </span>
    </div>
  );
}
