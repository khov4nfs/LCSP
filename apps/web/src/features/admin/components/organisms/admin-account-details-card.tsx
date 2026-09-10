"use client";

import type { MessageKey } from "@lcsp/i18n";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";

import { resolveAppMessage } from "@/lib/i18n";
import type { AdminAccountDetailsCardProps } from "@/features/admin/types/admin.types";
import { AdminDetailRow } from "@/features/admin/components/atoms/admin-detail-row";

function formatDate(isoString: string | null | undefined): string {
  if (!isoString) return "—";
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

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
    { label: fullNameLabel, value: user.fullName },
    { label: emailLabel, value: user.email },
    { label: roleLabel, value: roleDisplay },
    { label: createdLabel, value: formatDate(user.createdAt) },
    { label: lastActiveLabel, value: formatDate(user.lastActiveAt) },
  ];

  return (
    <div className="flex h-[252px] w-full max-w-[536px] flex-col justify-between rounded-xl border border-border bg-card p-6 shadow-xs">
      <h2 className="text-[15px] font-semibold text-foreground">{cardTitle}</h2>

      <div className="flex flex-col space-y-1 pt-2">
        {rows.map((row) => (
          <AdminDetailRow
            key={row.label}
            label={row.label}
            value={row.value}
            className="border-none py-1.5"
          />
        ))}
      </div>
    </div>
  );
}
