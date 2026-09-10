import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type AdminPageHeaderProps = {
  title: string;
  description?: string;
  actionSlot?: ReactNode;
  className?: string;
};

export function AdminPageHeader({
  title,
  description,
  actionSlot,
  className,
}: AdminPageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex flex-col space-y-1">
        <h1 className="text-[28px] font-semibold text-foreground tracking-tight">
          {title}
        </h1>
        {description ? (
          <p className="text-[13px] text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actionSlot ? <div>{actionSlot}</div> : null}
    </div>
  );
}
