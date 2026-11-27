import * as React from "react";
import type { MessageKey } from "@lcsp/i18n";
import { AUTH_ACCOUNT_STATUSES, type AuthUserRole, type AuthAccountStatus } from "@lcsp/contracts/auth";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface AdminUserIdentityHeroProps {
  fullName: string;
  email: string;
  role: AuthUserRole;
  status: AuthAccountStatus;
  className?: string;
}

export function AdminUserIdentityHero({
  fullName,
  email,
  role,
  status,
  className,
}: AdminUserIdentityHeroProps) {
  const isActive = status === AUTH_ACCOUNT_STATUSES.active;

  // Generate initials (e.g. "LT" for "Lifecycle Test User")
  const initials = fullName
    ? fullName
        .split(" ")
        .map((n) => n[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "U";

  const roleLabel =
    role === "ADMIN"
      ? resolveAppMessage("pages.admin.usersList.roles.ADMIN" as MessageKey)
      : resolveAppMessage("pages.admin.usersList.roles.CUSTOMER" as MessageKey);

  return (
    <div
      data-figma-node="1697:4554"
      data-figma-name="User identity"
      className={cn(
        "relative flex h-[104px] items-center justify-between overflow-hidden rounded-[16px] px-6 text-white shadow-xs",
        className,
      )}
      style={{
        background:
          "linear-gradient(90deg, rgba(16, 42, 56, 1) 0%, rgba(23, 73, 80, 1) 100%)",
      }}
    >
      <div className="flex items-center gap-4">
        {/* Avatar (#1697:4555) */}
        <div
          data-figma-node="1697:4555"
          data-figma-name="Avatar"
          className="flex size-[60px] items-center justify-center rounded-full bg-[#E2F6F1] text-[20px] font-semibold text-[#11545B]"
        >
          {initials}
        </div>

        {/* User Details */}
        <div className="flex flex-col">
          <h2 className="text-[22px] font-semibold leading-tight text-white tracking-tight">
            {fullName}
          </h2>
          <span className="text-[14px] text-[#C6DFE1]">
            {email} · {roleLabel}
          </span>
        </div>
      </div>

      {/* Status Pill (#1697:4559) */}
      <span
        data-figma-node="1697:4559"
        data-figma-name="Status"
        className={cn(
          "inline-flex items-center px-2.5 py-1 rounded-[6px] text-[12px] font-semibold border",
          isActive
            ? "bg-[#F0FDF4] text-[#166534] border-[#BBF7D0]"
            : "bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]",
        )}
      >
        {isActive ? "Active" : "Suspended"}
      </span>
    </div>
  );
}
