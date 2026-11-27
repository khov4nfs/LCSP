"use client";

import { SearchIcon } from "lucide-react";
import {
  AUTH_USER_ROLES,
  USER_ACCESS_STATUSES,
  type AuthUserRole,
  type UserAccessStatus,
} from "@lcsp/contracts/auth";
import type { MessageKey } from "@lcsp/i18n";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { resolveAppMessage } from "@/lib/i18n";
import type { AdminUserFiltersProps } from "@/features/admin/types/admin.types";

export function AdminUserFilters({
  filters,
  onSearchChange,
  onStatusChange,
  onRoleChange,
}: AdminUserFiltersProps) {
  const searchPlaceholder = resolveAppMessage(
    "pages.admin.usersList.searchPlaceholder" as MessageKey,
  );
  const searchAriaLabel = resolveAppMessage(
    "pages.admin.usersList.searchAriaLabel" as MessageKey,
  );
  const statusFilterAll = resolveAppMessage(
    "pages.admin.usersList.statusFilterAll" as MessageKey,
  );
  const roleFilterAll = resolveAppMessage(
    "pages.admin.usersList.roleFilterAll" as MessageKey,
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Search Input (320px x 34px - Figma 1709:7998) */}
      <div className="relative w-80 max-w-full">
        <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          type="search"
          value={filters.searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchAriaLabel}
          className="h-[34px] w-full rounded-[6px] border-border bg-card pl-9 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-primary shadow-xs"
        />
      </div>

      {/* Status Filter (170px x 34px - Figma 1709:8003) */}
      <div className="w-[170px]">
        <Select
          value={filters.statusFilter}
          onValueChange={(val) =>
            onStatusChange(val as UserAccessStatus | "ALL")
          }
        >
          <SelectTrigger
            className="!h-[34px] data-[size=default]:!h-[34px] w-full rounded-[6px] border-border bg-card text-[13px] text-foreground focus:ring-1 focus:ring-primary shadow-xs"
            aria-label={resolveAppMessage(
              "pages.admin.usersList.statusFilterLabel" as MessageKey,
            )}
          >
            <SelectValue placeholder={statusFilterAll}>
              {filters.statusFilter === "ALL"
                ? statusFilterAll
                : filters.statusFilter === USER_ACCESS_STATUSES.active
                  ? resolveAppMessage(
                      "pages.admin.usersList.statuses.ACTIVE" as MessageKey,
                    )
                  : filters.statusFilter === USER_ACCESS_STATUSES.suspended
                    ? resolveAppMessage(
                        "pages.admin.usersList.statuses.SUSPENDED" as MessageKey,
                      )
                    : statusFilterAll}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="border-border bg-card text-foreground">
            <SelectItem value="ALL" className="text-[13px]">
              {statusFilterAll}
            </SelectItem>
            <SelectItem
              value={USER_ACCESS_STATUSES.active}
              className="text-[13px]"
            >
              {resolveAppMessage(
                "pages.admin.usersList.statuses.ACTIVE" as MessageKey,
              )}
            </SelectItem>
            <SelectItem
              value={USER_ACCESS_STATUSES.suspended}
              className="text-[13px]"
            >
              {resolveAppMessage(
                "pages.admin.usersList.statuses.SUSPENDED" as MessageKey,
              )}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Role Filter (180px x 34px - Figma 1709:8007) */}
      <div className="w-[180px]">
        <Select
          value={filters.roleFilter}
          onValueChange={(val) => onRoleChange(val as AuthUserRole | "ALL")}
        >
          <SelectTrigger
            className="!h-[34px] data-[size=default]:!h-[34px] w-full rounded-[6px] border-border bg-card text-[13px] text-foreground focus:ring-1 focus:ring-primary shadow-xs"
            aria-label={resolveAppMessage(
              "pages.admin.usersList.roleFilterLabel" as MessageKey,
            )}
          >
            <SelectValue placeholder={roleFilterAll}>
              {filters.roleFilter === "ALL"
                ? roleFilterAll
                : filters.roleFilter === AUTH_USER_ROLES.customer
                  ? resolveAppMessage(
                      "pages.admin.usersList.roles.CUSTOMER" as MessageKey,
                    )
                  : filters.roleFilter === AUTH_USER_ROLES.admin
                    ? resolveAppMessage(
                        "pages.admin.usersList.roles.ADMIN" as MessageKey,
                      )
                    : roleFilterAll}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="border-border bg-card text-foreground">
            <SelectItem value="ALL" className="text-[13px]">
              {roleFilterAll}
            </SelectItem>
            <SelectItem value={AUTH_USER_ROLES.customer} className="text-[13px]">
              {resolveAppMessage(
                "pages.admin.usersList.roles.CUSTOMER" as MessageKey,
              )}
            </SelectItem>
            <SelectItem value={AUTH_USER_ROLES.admin} className="text-[13px]">
              {resolveAppMessage(
                "pages.admin.usersList.roles.ADMIN" as MessageKey,
              )}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
