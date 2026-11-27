import { Skeleton } from "@/components/ui/skeleton";

type AdminBillingMetricCardProps = {
  label: string;
  value: string | number | undefined;
  subtitle: string;
  isLoading: boolean;
};

/**
 * Business purpose: Display a single admin billing KPI card with loading skeleton and tabular numeric formatting.
 * Business rules:
 * - Renders skeleton placeholders while loading and em-dash fallback when value is undefined.
 * - Uses semantic card and foreground tokens from globals.css.
 * Execution flow:
 * 1. Render loading skeletons when isLoading is true; otherwise render label, tabular value, and subtitle.
 * Failure cases:
 * - Missing value falls back to em-dash without fabricating metrics.
 * Side effects:
 * - Pure presentational component.
 */
export function AdminBillingMetricCard({
  label,
  value,
  subtitle,
  isLoading,
}: AdminBillingMetricCardProps) {
  return (
    <section
      className="flex min-h-35 flex-col justify-between rounded-xl border border-border bg-card p-5 shadow-xs"
      data-component="AdminBillingMetricCard"
    >
      {isLoading ? (
        <>
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-48" />
        </>
      ) : (
        <>
          <span className="text-sm text-muted-foreground">{label}</span>
          <span className="text-3xl font-semibold tracking-tight text-foreground tabular-nums">
            {value ?? "\u2014"}
          </span>
          <span className="text-sm leading-4 text-muted-foreground">
            {subtitle}
          </span>
        </>
      )}
    </section>
  );
}
