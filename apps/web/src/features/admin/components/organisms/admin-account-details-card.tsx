import * as React from "react";
import type { MessageKey } from "@lcsp/i18n";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";

import { resolveAppMessage } from "@/lib/i18n";
import { formatLocaleDate } from "@/lib/date-format";
import type { AdminAccountDetailsCardProps } from "@/features/admin/types/admin.types";

export function AdminAccountDetailsCard({ user }: AdminAccountDetailsCardProps) {
  const cardTitle = resolveAppMessage(
    "pages.admin.userDetail.accountDetailsCard.title" as MessageKey,
  );
  const fullNameLabel = resolveAppMessage(
    "pages.admin.userDetail.accountDetailsCard.fullName" as MessageKey,
  );
  const emailLabel = resolveAppMessage(
    "pages.admin.userDetail.accountDetailsCard.email" as MessageKey,
  );
  const roleLabel = resolveAppMessage(
    "pages.admin.userDetail.accountDetailsCard.role" as MessageKey,
  );
  const createdLabel = resolveAppMessage(
    "pages.admin.userDetail.accountDetailsCard.created" as MessageKey,
  );

  const lastActiveLabel = resolveAppMessage(
    "pages.admin.userDetail.accountDetailsCard.lastActive" as MessageKey,
  );

  const roleDisplay =
    user.role === AUTH_USER_ROLES.admin
      ? resolveAppMessage("pages.admin.usersList.roles.ADMIN" as MessageKey)
      : resolveAppMessage("pages.admin.usersList.roles.CUSTOMER" as MessageKey);

  const rows = [
    { label: fullNameLabel, value: user.fullName || "—" },
    { label: emailLabel, value: user.email },
    { label: roleLabel, value: roleDisplay },
    { label: createdLabel, value: formatLocaleDate(user.createdAt) },
    {
      label: lastActiveLabel,
      value: user.lastActiveAt ? formatLocaleDate(user.lastActiveAt) : "—",
    },
  ];

  return (
    <div
      data-figma-node="1697:4561"
      data-figma-name="Account details"
      className="flex h-[255px] w-full flex-col justify-between rounded-[12px] border border-border bg-card p-5 shadow-xs"
    >
      <h2 className="text-[16px] font-semibold text-foreground tracking-tight">
        {cardTitle}
      </h2>

      <div className="flex flex-col divide-y divide-border">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between py-2 text-[13px]"
          >
            <span className="text-muted-foreground">{row.label}</span>
            <span className="font-medium text-foreground">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
