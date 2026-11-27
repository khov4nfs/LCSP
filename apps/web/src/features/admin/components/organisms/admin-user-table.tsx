"use client";

import * as React from "react";
import type { MessageKey } from "@lcsp/i18n";
import { AUTH_ACCOUNT_STATUSES } from "@lcsp/contracts/auth";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveAppMessage } from "@/lib/i18n";
import { formatLocaleDate } from "@/lib/date-format";
import { cn } from "@/lib/utils";
import type { AdminUsersTableProps } from "@/features/admin/types/admin.types";
import { AdminRoleBadge } from "@/features/admin/components/atoms/admin-role-badge";

interface AdminUserTableFullProps extends AdminUsersTableProps {
  totalCount?: number;
  toolbarSlot?: React.ReactNode;
  paginationSlot?: React.ReactNode;
}

export function AdminUserTable({
  users,
  isLoading = false,
  onViewUser,
  totalCount,
  toolbarSlot,
  paginationSlot,
}: AdminUserTableFullProps) {
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
  const colActions = resolveAppMessage(
    "pages.admin.usersList.columns.actions" as MessageKey,
  );
  const viewLabel = resolveAppMessage(
    "pages.admin.usersList.viewAction" as MessageKey,
  );
  const tableAriaLabel = resolveAppMessage(
    "pages.admin.usersList.tableAriaLabel" as MessageKey,
  );

  return (
    <div
      data-figma-node="1684:2658"
      data-figma-name="Management table"
      className="w-full overflow-hidden rounded-[12px] border border-border bg-card shadow-xs"
    >
      {/* CardHeader / DataTableToolbar (Figma 1711:9036) */}
      <div
        data-figma-node="1711:9036"
        data-figma-name="CardHeader / DataTableToolbar"
        className="flex flex-col gap-3 p-4 border-b border-border bg-card"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[18px] font-semibold text-foreground tracking-tight">
            All accounts
          </h2>
          {totalCount !== undefined && (
            <span className="text-[12px] text-muted-foreground">
              Showing {users.length} of {totalCount} records
            </span>
          )}
        </div>
        {toolbarSlot && <div>{toolbarSlot}</div>}
      </div>

      {/* Table Content */}
      {isLoading ? (
        <div className="p-4 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg bg-muted" />
          ))}
        </div>
      ) : users.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm font-semibold text-foreground">
            {resolveAppMessage("pages.admin.usersList.emptyTitle" as MessageKey)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {resolveAppMessage(
              "pages.admin.usersList.emptyDescription" as MessageKey,
            )}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table
            className="w-full text-left border-collapse"
            aria-label={tableAriaLabel}
          >
            {/* TableHeader (Figma 1711:9037) */}
            <thead>
              <tr
                data-figma-node="1711:9037"
                data-figma-name="TableHeader"
                className="border-b border-border bg-muted/40 text-[13px] font-semibold text-foreground"
              >
                <th className="py-2.5 pl-4 pr-3">{colUser}</th>
                <th className="px-3 py-2.5">Email</th>
                <th className="px-3 py-2.5">{colRole}</th>
                <th className="px-3 py-2.5">{colStatus}</th>
                <th className="px-3 py-2.5">{colCreated}</th>
                <th className="px-3 py-2.5">{colLastActive}</th>
                <th className="py-2.5 pl-3 pr-4 text-right">{colActions}</th>
              </tr>
            </thead>

            {/* TableBody (Figma 1711:9039) */}
            <tbody
              data-figma-node="1711:9039"
              data-figma-name="TableBody"
              className="divide-y divide-border text-[13px]"
            >
              {users.map((user) => {
                const isActive = user.status === AUTH_ACCOUNT_STATUSES.active;
                return (
                  <tr
                    key={user.id}
                    data-figma-node="1684:2607"
                    data-figma-name="LCSP Data / Management row / 45"
                    className="hover:bg-muted/30 transition-colors"
                  >
                    {/* User Name */}
                    <td className="py-3 pl-4 pr-3 font-semibold text-foreground">
                      {user.fullName || "—"}
                    </td>

                    {/* Email */}
                    <td className="px-3 py-3 text-muted-foreground">
                      {user.email}
                    </td>

                    {/* Role */}
                    <td className="px-3 py-3">
                      <AdminRoleBadge role={user.role} />
                    </td>

                    {/* Status Pill (Figma 1681:1297 / 1681:1301) */}
                    <td className="px-3 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded-[6px] text-[12px] font-semibold border",
                          isActive
                            ? "bg-primary/10 text-primary border-primary/20"
                            : "bg-destructive/10 text-destructive border-destructive/20",
                        )}
                      >
                        {isActive ? "Active" : "Suspended"}
                      </span>
                    </td>

                    {/* Created Date */}
                    <td className="px-3 py-3 text-muted-foreground">
                      {formatLocaleDate(user.createdAt)}
                    </td>

                    {/* Last Active Date */}
                    <td className="px-3 py-3 text-muted-foreground">
                      {user.lastActiveAt
                        ? formatLocaleDate(user.lastActiveAt)
                        : "—"}
                    </td>

                    {/* Actions -> View account › (Figma 1684:2648) */}
                    <td className="py-3 pl-3 pr-4 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => onViewUser(user.id)}
                        className="h-auto p-0 text-[13px] font-medium text-primary hover:text-primary/80 hover:bg-transparent"
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
      )}

      {/* TableFooter / Pagination (Figma 1711:9038) */}
      {paginationSlot && (
        <div
          data-figma-node="1711:9038"
          data-figma-name="TableFooter / Pagination"
          className="border-t border-border bg-card px-4 py-2"
        >
          {paginationSlot}
        </div>
      )}
    </div>
  );
}
