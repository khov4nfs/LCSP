import type { MessageKey } from "@lcsp/i18n";
import { AUTH_USER_ROLES, type AuthUserRole } from "@lcsp/contracts/auth";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type AdminRoleBadgeProps = {
  role: AuthUserRole;
  className?: string;
  size?: "sm" | "md";
};

export function AdminRoleBadge({
  role,
  className,
  size = "md",
}: AdminRoleBadgeProps) {
  const isAdmin = role === AUTH_USER_ROLES.admin;

  const label = isAdmin
    ? resolveAppMessage("pages.admin.usersList.roles.ADMIN" as MessageKey)
    : resolveAppMessage("pages.admin.usersList.roles.CUSTOMER" as MessageKey);

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md font-semibold tracking-wide",
        size === "sm" && "px-2 py-0.5 text-[11px]",
        size === "md" && "px-2.5 py-1 text-[12px]",
        isAdmin
          ? "border border-primary/25 bg-primary/10 text-primary"
          : "border border-border bg-secondary text-secondary-foreground",
        className,
      )}
    >
      {label}
    </span>
  );
}
