"use client";

import type { MessageKey } from "@lcsp/i18n";
import { AUTH_ACCOUNT_STATUSES } from "@lcsp/contracts/auth";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { AdminUsersTableProps } from "@/features/admin/types/admin.types";
import { AdminUserIdentityCell } from "@/features/admin/components/molecules/admin-user-identity-cell";
import { AdminRoleBadge } from "@/features/admin/components/atoms/admin-role-badge";
import { AdminStatusDot } from "@/features/admin/components/atoms/admin-status-dot";

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

export function AdminUserTable({
  users,
  isLoading = false,
  onViewUser,
}: AdminUsersTableProps) {
  const colUser = resolveAppMessage(
    "pages.admin.usersList.columns.user" as MessageKey,
  );
  const colRole = resolveAppMessage(
    "pages.admin.usersList.columns.role" as MessageKey,
  );
  const colStatus = resolveAppMessage(
    "pages.admin.usersList.columns.status" as MessageKey,
  );
  const colCreated = resolveAppMessage(
    "pages.admin.usersList.columns.created" as MessageKey,
  );
  const colLastActive = resolveAppMessage(
    "pages.admin.usersList.columns.lastActive" as MessageKey,
  );
  const colAssessments = resolveAppMessage(
    "pages.admin.usersList.columns.assessments" as MessageKey,
  );
  const colActions = resolveAppMessage(
    "pages.admin.usersList.columns.actions" as MessageKey,
  );
  const viewLabel = resolveAppMessage(
    "pages.admin.usersList.viewAction" as MessageKey,
  );
  const viewUserAriaTemplate = resolveAppMessage(
    "pages.admin.usersList.viewUserAria" as MessageKey,
  );
  const tableAriaLabel = resolveAppMessage(
    "pages.admin.usersList.tableAriaLabel" as MessageKey,
  );

  if (isLoading) {
    return (
      <div className="w-full max-w-278 rounded-xl border border-border bg-card p-4 shadow-xs">
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="flex w-full max-w-278 flex-col items-center justify-center rounded-xl border border-border bg-card py-16 text-center shadow-xs">
        <p className="text-sm font-semibold text-foreground">
          {resolveAppMessage("pages.admin.usersList.emptyTitle" as MessageKey)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {resolveAppMessage(
            "pages.admin.usersList.emptyDescription" as MessageKey,
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-278 overflow-hidden rounded-xl border border-border bg-card shadow-xs">
      <div className="overflow-x-auto">
        <table
          className="w-full text-left border-collapse"
          aria-label={tableAriaLabel}
        >
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="w-75 py-3.5 pl-6 pr-4 text-[10.5px] font-semibold tracking-wider text-muted-foreground uppercase">
                {colUser}
              </th>
              <th className="w-36 px-4 py-3.5 text-[10.5px] font-semibold tracking-wider text-muted-foreground uppercase">
                {colRole}
              </th>
              <th className="w-27.5 px-4 py-3.5 text-[10.5px] font-semibold tracking-wider text-muted-foreground uppercase">
                {colStatus}
              </th>
              <th className="w-34.5 px-4 py-3.5 text-[10.5px] font-semibold tracking-wider text-muted-foreground uppercase">
                {colCreated}
              </th>
              <th className="w-31.5 px-4 py-3.5 text-[10.5px] font-semibold tracking-wider text-muted-foreground uppercase">
                {colLastActive}
              </th>
              <th className="w-27.5 px-4 py-3.5 text-[10.5px] font-semibold tracking-wider text-muted-foreground uppercase">
                {colAssessments}
              </th>
              <th className="py-3.5 pl-4 pr-6 text-right">
                <span className="sr-only">{colActions}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {users.map((user) => {
              const statusDisplay =
                user.status === AUTH_ACCOUNT_STATUSES.active
                  ? resolveAppMessage(
                      "pages.admin.usersList.statuses.ACTIVE" as MessageKey,
                    )
                  : user.status === AUTH_ACCOUNT_STATUSES.suspended
                    ? resolveAppMessage(
                        "pages.admin.usersList.statuses.SUSPENDED" as MessageKey,
                      )
                    : user.status === AUTH_ACCOUNT_STATUSES.invited
                      ? resolveAppMessage(
                          "pages.admin.usersList.statuses.INVITED" as MessageKey,
                        )
                      : resolveAppMessage(
                          "pages.admin.usersList.statuses.DEACTIVATED" as MessageKey,
                        );

              const isSuspended =
                user.status === AUTH_ACCOUNT_STATUSES.suspended;
              const isActive = user.status === AUTH_ACCOUNT_STATUSES.active;

              return (
                <tr
                  key={user.id}
                  className="h-17 transition-colors hover:bg-muted/30"
                >
                  {/* User (Name + Email) */}
                  <td className="w-75 py-3 pl-6 pr-4">
                    <AdminUserIdentityCell
                      fullName={user.fullName}
                      email={user.email}
                    />
                  </td>

                  {/* Role */}
                  <td className="w-36 px-4 py-3">
                    <AdminRoleBadge role={user.role} size="sm" />
                  </td>

                  {/* Status */}
                  <td className="w-27.5 px-4 py-3">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 text-[11.5px] font-medium",
                        isActive && "text-admin-status-active-foreground",
                        isSuspended && "text-admin-status-suspended-foreground",
                        !isActive && !isSuspended && "text-muted-foreground",
                      )}
                    >
                      <AdminStatusDot status={user.status} />
                      {statusDisplay}
                    </span>
                  </td>

                  {/* Created */}
                  <td className="w-34.5 px-4 py-3 text-[11.5px] text-muted-foreground">
                    {formatDate(user.createdAt)}
                  </td>

                  {/* Last Active */}
                  <td className="w-31.5 px-4 py-3 text-[11.5px] text-muted-foreground">
                    {formatDate(user.lastActiveAt)}
                  </td>

                  {/* Assessments Count */}
                  <td className="w-27.5 px-4 py-3 text-[11.5px] font-medium text-foreground">
                    {user.assessmentCount !== null &&
                    user.assessmentCount !== undefined
                      ? user.assessmentCount
                      : "—"}
                  </td>

                  {/* Action Button */}
                  <td className="py-3 pl-4 pr-6 text-right">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onViewUser(user.id)}
                      aria-label={viewUserAriaTemplate.replace(
                        "{name}",
                        user.fullName,
                      )}
                      className="h-8.5 w-22.5 rounded-[10px] border-border bg-secondary text-[12.5px] font-medium text-secondary-foreground hover:bg-secondary/80 shadow-xs"
                    >
                      {viewLabel}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
