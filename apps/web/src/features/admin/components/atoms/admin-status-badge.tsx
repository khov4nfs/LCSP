import type { MessageKey } from "@lcsp/i18n";
import { AUTH_ACCOUNT_STATUSES, type AuthAccountStatus } from "@lcsp/contracts/auth";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { AdminStatusDot } from "./admin-status-dot";

type AdminStatusBadgeProps = {
  status: AuthAccountStatus;
  className?: string;
  size?: "sm" | "md";
};

export function AdminStatusBadge({
  status,
  className,
  size = "md",
}: AdminStatusBadgeProps) {
  const isActive = status === AUTH_ACCOUNT_STATUSES.active;
  const isSuspended = status === AUTH_ACCOUNT_STATUSES.suspended;

  const label =
    status === AUTH_ACCOUNT_STATUSES.active
      ? resolveAppMessage("pages.admin.userDetail.statusPill.active" as MessageKey)
      : status === AUTH_ACCOUNT_STATUSES.suspended
        ? resolveAppMessage("pages.admin.userDetail.statusPill.suspended" as MessageKey)
        : status === AUTH_ACCOUNT_STATUSES.invited
          ? resolveAppMessage("pages.admin.userDetail.statusPill.invited" as MessageKey)
          : resolveAppMessage("pages.admin.userDetail.statusPill.deactivated" as MessageKey);

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-semibold",
        size === "sm" && "h-[26px] px-2.5 text-[11.5px]",
        size === "md" && "h-[32px] px-3.5 text-[12.5px]",
        isActive &&
          "border-admin-status-active-border bg-admin-status-active-surface text-admin-status-active-foreground",
        isSuspended &&
          "border-admin-status-suspended-border bg-admin-status-suspended-surface text-admin-status-suspended-foreground",
        !isActive &&
          !isSuspended &&
          "border-border bg-secondary text-muted-foreground",
        className,
      )}
    >
      <AdminStatusDot status={status} />
      <span>{label}</span>
    </div>
  );
}
