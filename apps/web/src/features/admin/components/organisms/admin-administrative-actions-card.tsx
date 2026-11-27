import * as React from "react";
import { AUTH_ACCOUNT_STATUSES } from "@lcsp/contracts/auth";
import type { MessageKey } from "@lcsp/i18n";

import { Button } from "@/components/ui/button";
import { resolveAppMessage } from "@/lib/i18n";
import type { AdminAdministrativeActionsCardProps } from "@/features/admin/types/admin.types";
import { cn } from "@/lib/utils";

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
  const cannotManage = user.version === undefined;

  return (
    <div
      data-figma-node="1697:4575"
      data-figma-name="Administrative controls"
      className="flex h-[255px] w-full flex-col justify-between rounded-[14px] border border-border bg-card p-5 shadow-xs"
    >
      <div>
        <h2 className="text-[16px] font-semibold text-foreground tracking-tight">
          {cardTitle}
        </h2>

        {/* Account status row with inline status badge */}
        <div className="mt-4 flex items-center justify-between">
          <span className="text-[13px] font-medium text-muted-foreground">
            {accountAccessLabel}
          </span>
          <span
            className={cn(
              "inline-flex items-center px-2 py-0.5 rounded-[6px] text-[12px] font-semibold border",
              !isSuspended
                ? "bg-primary/10 text-primary border-primary/20"
                : "bg-destructive/10 text-destructive border-destructive/20",
            )}
          >
            {!isSuspended ? "Active" : "Suspended"}
          </span>
        </div>

        {/* Explanatory notice */}
        <p className="mt-3 text-[13px] text-muted-foreground">
          Roles and suspension require independent approval.
        </p>
      </div>

      {/* Action button Figma 1711:8469 */}
      <div className="border-t border-border pt-4">
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
          className={cn(
            "h-[36px] px-4 rounded-[7px] text-[13px] font-semibold transition-colors shadow-xs disabled:opacity-40",
            isSuspended
              ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
              : "border-destructive/30 bg-destructive text-destructive-foreground hover:bg-destructive/90",
          )}
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
