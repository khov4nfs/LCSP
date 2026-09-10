import { cn } from "@/lib/utils";

type AdminMetricCardProps = {
  label: string;
  value: string;
  widthClass?: string;
  className?: string;
};

export function AdminMetricCard({
  label,
  value,
  widthClass = "w-full sm:w-[260px]",
  className,
}: AdminMetricCardProps) {
  return (
    <div
      className={cn(
        "flex h-[112px] flex-col justify-between rounded-xl border border-border bg-card p-5 shadow-xs",
        widthClass,
        className,
      )}
    >
      <span className="text-[11.5px] font-medium text-muted-foreground">
        {label}
      </span>
      <span className="text-[24px] font-semibold text-foreground tracking-tight">
        {value}
      </span>
    </div>
  );
}
