"use client";

import { SearchIcon, UserPlusIcon } from "lucide-react";
import {
  AUTH_ACCOUNT_STATUSES,
  AUTH_USER_ROLES,
  type AuthAccountStatus,
  type AuthUserRole,
} from "@lcsp/contracts/auth";
import type { MessageKey } from "@lcsp/i18n";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { resolveAppMessage } from "@/lib/i18n";
import type { AdminUserFiltersProps } from "@/features/admin/types/admin.types";

export function AdminUserFilters({
  filters,
  onSearchChange,
  onStatusChange,
  onRoleChange,
  onCreateUserClick,
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
  const createUserLabel = resolveAppMessage(
    "pages.admin.usersList.createUser" as MessageKey,
  );
  const createUserDisabledTooltip = resolveAppMessage(
    "pages.admin.usersList.createUserDisabledTooltip" as MessageKey,
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Search Input (420px x 42px) */}
      <div className="relative w-105 max-w-full">
        <SearchIcon className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          type="search"
          value={filters.searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchAriaLabel}
          className="h-10.5 w-full rounded-lg border-border bg-card pl-10 pr-3 text-[12.5px] text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-primary shadow-xs"
        />
      </div>

      {/* Status Filter (160px x 42px) */}
      <div className="w-40">
        <Select
          value={filters.statusFilter}
          onValueChange={(val) =>
            onStatusChange(val as AuthAccountStatus | "ALL")
          }
        >
          <SelectTrigger
            className="!h-10.5 data-[size=default]:!h-10.5 w-full rounded-lg border-border bg-card text-[12.5px] text-foreground focus:ring-1 focus:ring-primary shadow-xs"
            aria-label={resolveAppMessage(
              "pages.admin.usersList.statusFilterLabel" as MessageKey,
            )}
          >
            <SelectValue placeholder={statusFilterAll}>
              {filters.statusFilter === "ALL"
                ? statusFilterAll
                : filters.statusFilter === AUTH_ACCOUNT_STATUSES.active
                  ? resolveAppMessage(
                      "pages.admin.usersList.statuses.ACTIVE" as MessageKey,
                    )
                  : filters.statusFilter === AUTH_ACCOUNT_STATUSES.suspended
                    ? resolveAppMessage(
                        "pages.admin.usersList.statuses.SUSPENDED" as MessageKey,
                      )
                    : filters.statusFilter === AUTH_ACCOUNT_STATUSES.invited
                      ? resolveAppMessage(
                          "pages.admin.usersList.statuses.INVITED" as MessageKey,
                        )
                      : filters.statusFilter ===
                          AUTH_ACCOUNT_STATUSES.deactivated
                        ? resolveAppMessage(
                            "pages.admin.usersList.statuses.DEACTIVATED" as MessageKey,
                          )
                        : statusFilterAll}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="border-border bg-card text-foreground">
            <SelectItem value="ALL" className="text-[12.5px]">
              {statusFilterAll}
            </SelectItem>
            <SelectItem
              value={AUTH_ACCOUNT_STATUSES.active}
              className="text-[12.5px]"
            >
              {resolveAppMessage(
                "pages.admin.usersList.statuses.ACTIVE" as MessageKey,
              )}
            </SelectItem>
            <SelectItem
              value={AUTH_ACCOUNT_STATUSES.suspended}
              className="text-[12.5px]"
            >
              {resolveAppMessage(
                "pages.admin.usersList.statuses.SUSPENDED" as MessageKey,
              )}
            </SelectItem>
            <SelectItem
              value={AUTH_ACCOUNT_STATUSES.invited}
              className="text-[12.5px]"
            >
              {resolveAppMessage(
                "pages.admin.usersList.statuses.INVITED" as MessageKey,
              )}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Role Filter (150px x 42px) */}
      <div className="w-37.5">
        <Select
          value={filters.roleFilter}
          onValueChange={(val) => onRoleChange(val as AuthUserRole | "ALL")}
        >
          <SelectTrigger
            className="!h-10.5 data-[size=default]:!h-10.5 w-full rounded-lg border-border bg-card text-[12.5px] text-foreground focus:ring-1 focus:ring-primary shadow-xs"
            aria-label={resolveAppMessage(
              "pages.admin.usersList.roleFilterLabel" as MessageKey,
            )}
          >
            <SelectValue placeholder={roleFilterAll}>
              {filters.roleFilter === "ALL"
                ? roleFilterAll
                : filters.roleFilter === AUTH_USER_ROLES.admin
                  ? resolveAppMessage(
                      "pages.admin.usersList.roles.ADMIN" as MessageKey,
                    )
                  : filters.roleFilter === AUTH_USER_ROLES.customer
                    ? resolveAppMessage(
                        "pages.admin.usersList.roles.CUSTOMER" as MessageKey,
                      )
                    : roleFilterAll}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="border-border bg-card text-foreground">
            <SelectItem value="ALL" className="text-[12.5px]">
              {roleFilterAll}
            </SelectItem>
            <SelectItem value={AUTH_USER_ROLES.admin} className="text-[12.5px]">
              {resolveAppMessage(
                "pages.admin.usersList.roles.ADMIN" as MessageKey,
              )}
            </SelectItem>
            <SelectItem
              value={AUTH_USER_ROLES.customer}
              className="text-[12.5px]"
            >
              {resolveAppMessage(
                "pages.admin.usersList.roles.CUSTOMER" as MessageKey,
              )}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Create User Button (146px x 42px, light on dark / dark on light, right-aligned) */}
      <div className="ml-auto">
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className="inline-flex"
                tabIndex={onCreateUserClick ? undefined : 0}
              />
            }
          >
            <Button
              type="button"
              onClick={onCreateUserClick}
              disabled={!onCreateUserClick}
              className="h-10.5 w-36.5 rounded-lg bg-primary text-[12.5px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <UserPlusIcon className="size-4 mr-1.5" />
              {createUserLabel}
            </Button>
          </TooltipTrigger>
          {!onCreateUserClick && (
            <TooltipContent className="max-w-xs text-xs">
              {createUserDisabledTooltip}
            </TooltipContent>
          )}
        </Tooltip>
      </div>
    </div>
  );
}
