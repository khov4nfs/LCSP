"use client";

import { AUTH_ACCOUNT_STATUSES } from "@lcsp/contracts/auth";
import type { MessageKey } from "@lcsp/i18n";

import { Button } from "@/components/ui/button";
import { resolveAppMessage } from "@/lib/i18n";
import type { AdminAdministrativeActionsCardProps } from "@/features/admin/types/admin.types";

export function AdminAdministrativeActionsCard({
  user,
  onOpenSuspendModal,
  onRestore,
  isRestoring = false,
}: AdminAdministrativeActionsCardProps) {
  const cardTitle = resolveAppMessage(
    "pages.admin.userDetail.administrativeActionsCard.title" as MessageKey,
  );
  const accountAccessLabel = resolveAppMessage(
    "pages.admin.userDetail.administrativeActionsCard.accountAccessLabel" as MessageKey,
  );
  const activeAccessCopy = resolveAppMessage(
    "pages.admin.userDetail.administrativeActionsCard.activeAccessCopy" as MessageKey,
  );
  const suspendedAccessCopy = resolveAppMessage(
    "pages.admin.userDetail.administrativeActionsCard.suspendedAccessCopy" as MessageKey,
  );
  const suspendAccountLabel = resolveAppMessage(
    "pages.admin.userDetail.administrativeActionsCard.suspendAccount" as MessageKey,
  );

  const isSuspended = user.status === AUTH_ACCOUNT_STATUSES.suspended;
  const isInvited = user.status === AUTH_ACCOUNT_STATUSES.invited;
  const cannotManage = isInvited || user.version === undefined;

  return (
    <div className="flex w-full max-w-139 flex-col gap-6 self-start rounded-xl border border-border bg-card p-6 shadow-xs">
      <h2 className="text-[15px] font-semibold text-foreground">{cardTitle}</h2>

      {/* Account Access & Suspend Row */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col space-y-1">
          <span className="text-[11.5px] font-semibold text-foreground">
            {accountAccessLabel}
          </span>
          <span className="text-[11.5px] text-muted-foreground leading-tight max-w-70">
            {isInvited
              ? resolveAppMessage("pages.accountLifecycle.invitePending")
              : isSuspended
                ? suspendedAccessCopy
                : activeAccessCopy}
          </span>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={
            isSuspended
              ? () => {
                  void onRestore?.();
                }
              : onOpenSuspendModal
          }
          disabled={cannotManage || isRestoring || (isSuspended && !onRestore)}
          className="h-9.5 w-45 rounded-lg border-admin-danger-border bg-admin-danger-surface text-[12.5px] font-semibold text-admin-danger-foreground hover:bg-admin-danger-surface-hover disabled:opacity-40"
        >
          {isSuspended
            ? resolveAppMessage(
                isRestoring
                  ? "pages.accountLifecycle.restoring"
                  : "pages.accountLifecycle.restore",
              )
            : suspendAccountLabel}
        </Button>
      </div>
    </div>
  );
}
