import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type AdminDetailRowProps = {
  label: string;
  value: ReactNode;
  className?: string;
};

export function AdminDetailRow({
  label,
  value,
  className,
}: AdminDetailRowProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between py-2 border-b border-border/50 last:border-0",
        className,
      )}
    >
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
      <div className="text-[12.5px] font-medium text-foreground">{value}</div>
    </div>
  );
}
