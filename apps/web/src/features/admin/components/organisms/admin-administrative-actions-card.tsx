"use client";

import { useState } from "react";
import {
  AUTH_ACCOUNT_STATUSES,
  AUTH_USER_ROLES,
  type AuthUserRole,
} from "@lcsp/contracts/auth";
import type { MessageKey } from "@lcsp/i18n";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { resolveAppMessage } from "@/lib/i18n";
import type { AdminAdministrativeActionsCardProps } from "@/features/admin/types/admin.types";

export function AdminAdministrativeActionsCard({
  user,
  onRoleSave,
  onOpenSuspendModal,
  isSavingRole = false,
}: AdminAdministrativeActionsCardProps) {
  const [selectedRole, setSelectedRole] = useState<AuthUserRole>(user.role);

  const cardTitle = resolveAppMessage(
    "pages.admin.userDetail.administrativeActionsCard.title" as MessageKey,
  );
  const roleLabel = resolveAppMessage(
    "pages.admin.userDetail.administrativeActionsCard.roleLabel" as MessageKey,
  );
  const saveRoleLabel = resolveAppMessage(
    "pages.admin.userDetail.administrativeActionsCard.saveRole" as MessageKey,
  );
  const savingRoleLabel = resolveAppMessage(
    "pages.admin.userDetail.administrativeActionsCard.savingRole" as MessageKey,
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

  const isRoleChanged = selectedRole !== user.role;
  const isSuspended = user.status === AUTH_ACCOUNT_STATUSES.suspended;

  const handleSaveRole = async () => {
    if (!isRoleChanged || isSavingRole) return;
    await onRoleSave(selectedRole);
  };

  return (
    <div className="flex h-[252px] w-full max-w-[556px] flex-col justify-between rounded-xl border border-border bg-card p-6 shadow-xs">
      <h2 className="text-[15px] font-semibold text-foreground">{cardTitle}</h2>

      {/* Role Management Row */}
      <div className="flex flex-col space-y-2 pt-1">
        <div className="flex items-center justify-between gap-3">
          <span className="w-[100px] shrink-0 text-[11.5px] font-medium text-muted-foreground">
            {roleLabel}
          </span>

          <div className="w-[180px]">
            <Select
              value={selectedRole}
              onValueChange={(val) => setSelectedRole(val as AuthUserRole)}
            >
              <SelectTrigger
                className="!h-[38px] data-[size=default]:!h-[38px] w-full rounded-[9px] border-border bg-background text-[12.5px] text-foreground focus:ring-1 focus:ring-primary shadow-xs"
                aria-label={roleLabel}
              >
                <SelectValue>
                  {selectedRole === AUTH_USER_ROLES.admin
                    ? resolveAppMessage("pages.admin.usersList.roles.ADMIN" as MessageKey)
                    : resolveAppMessage("pages.admin.usersList.roles.CUSTOMER" as MessageKey)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="border-border bg-card text-foreground">
                <SelectItem
                  value={AUTH_USER_ROLES.admin}
                  className="text-[12.5px]"
                >
                  {resolveAppMessage("pages.admin.usersList.roles.ADMIN" as MessageKey)}
                </SelectItem>
                <SelectItem
                  value={AUTH_USER_ROLES.customer}
                  className="text-[12.5px]"
                >
                  {resolveAppMessage("pages.admin.usersList.roles.CUSTOMER" as MessageKey)}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button
            type="button"
            onClick={handleSaveRole}
            disabled={!isRoleChanged || isSavingRole}
            className="h-[38px] w-[150px] rounded-[10px] bg-primary text-[12.5px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            {isSavingRole ? savingRoleLabel : saveRoleLabel}
          </Button>
        </div>
      </div>

      <div className="h-px bg-border/60" />

      {/* Account Access & Suspend Row */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col space-y-1">
          <span className="text-[11.5px] font-semibold text-foreground">
            {accountAccessLabel}
          </span>
          <span className="text-[11.5px] text-muted-foreground leading-tight max-w-[280px]">
            {isSuspended ? suspendedAccessCopy : activeAccessCopy}
          </span>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={onOpenSuspendModal}
          disabled={isSuspended}
          className="h-[38px] w-[180px] rounded-[10px] border-admin-danger-border bg-admin-danger-surface text-[12.5px] font-semibold text-admin-danger-foreground hover:bg-admin-danger-surface-hover disabled:opacity-40"
        >
          {suspendAccountLabel}
        </Button>
      </div>
    </div>
  );

}
