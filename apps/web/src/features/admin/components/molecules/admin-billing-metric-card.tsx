import { Skeleton } from "@/components/ui/skeleton";

type AdminBillingMetricCardProps = {
  label: string;
  value: string | number | undefined;
  subtitle: string;
  isLoading: boolean;
};

export function AdminBillingMetricCard({
  label,
  value,
  subtitle,
  isLoading,
}: AdminBillingMetricCardProps) {
  return (
    <section className="flex min-h-35 flex-col justify-between rounded-xl border border-border bg-card p-5 shadow-xs">
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
