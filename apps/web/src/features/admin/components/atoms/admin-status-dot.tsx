import { AUTH_ACCOUNT_STATUSES, type AuthAccountStatus } from "@lcsp/contracts/auth";
import { cn } from "@/lib/utils";

type AdminStatusDotProps = {
  status: AuthAccountStatus;
  className?: string;
};

export function AdminStatusDot({ status, className }: AdminStatusDotProps) {
  const isActive = status === AUTH_ACCOUNT_STATUSES.active;
  const isSuspended = status === AUTH_ACCOUNT_STATUSES.suspended;

  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        isActive && "bg-admin-status-active",
        isSuspended && "bg-admin-status-suspended",
        !isActive && !isSuspended && "bg-muted-foreground",
        className,
      )}
      aria-hidden="true"
    />
  );
}
