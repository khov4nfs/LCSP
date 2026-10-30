import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import type { TrackingEmptyStateProps } from "../../types/tracking-ui.types";

export function TrackingEmptyState({
  children,
  className,
}: TrackingEmptyStateProps) {
  return (
    <Empty
      className={cn(
        "flex-none items-start gap-0 border-0 p-0 text-left",
        className,
      )}
    >
      <EmptyHeader className="max-w-none items-start gap-0">
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
