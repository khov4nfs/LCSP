"use client";

import type { MessageKey } from "@lcsp/i18n";
import {
  ADMIN_OVERVIEW_ACTION_KEYS,
  type AdminRecentActivityItem,
} from "@lcsp/contracts/auth";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatLocaleActivityTime } from "@/lib/date-format";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import Link from "next/link";
import {
  AdminEventsTableRow,
  AdminSectionCardHeader,
  AdminStatusBadge,
} from "./admin-overview-primitives";

type AdminRecentActivityCardProps = {
  items?: AdminRecentActivityItem[];
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  className?: string;
};

export function AdminRecentActivityCard({
  items = [],
  isLoading = false,
  isError = false,
  onRetry,
  className,
}: AdminRecentActivityCardProps) {
  const title = resolveAppMessage(
    "pages.admin.overview.recentActivity.title" as MessageKey,
  );
  const subtitle = resolveAppMessage(
    "pages.admin.overview.recentActivity.subtitle" as MessageKey,
  );

  const resolveAreaLabel = (item: AdminRecentActivityItem): string => {
    switch (item.actionKey) {
      case ADMIN_OVERVIEW_ACTION_KEYS.suspendedAccount:
      case ADMIN_OVERVIEW_ACTION_KEYS.restoredAccount:
      case ADMIN_OVERVIEW_ACTION_KEYS.invitedUser:
        return "User accounts";
      case ADMIN_OVERVIEW_ACTION_KEYS.activatedLegalSource:
        return "Legal sources";
      default:
        return "Operations";
    }
  };

  const resolveStatusVariant = (
    item: AdminRecentActivityItem,
  ): "success" | "warning" | "danger" | "info" => {
    switch (item.actionKey) {
      case ADMIN_OVERVIEW_ACTION_KEYS.suspendedAccount:
        return "danger";
      case ADMIN_OVERVIEW_ACTION_KEYS.restoredAccount:
      case ADMIN_OVERVIEW_ACTION_KEYS.activatedLegalSource:
        return "success";
      case ADMIN_OVERVIEW_ACTION_KEYS.invitedUser:
        return "info";
      default:
        return "info";
    }
  };

  const resolveStatusLabel = (item: AdminRecentActivityItem): string => {
    switch (item.actionKey) {
      case ADMIN_OVERVIEW_ACTION_KEYS.suspendedAccount:
        return "Suspended";
      case ADMIN_OVERVIEW_ACTION_KEYS.restoredAccount:
        return "Restored";
      case ADMIN_OVERVIEW_ACTION_KEYS.invitedUser:
        return "Invited";
      case ADMIN_OVERVIEW_ACTION_KEYS.activatedLegalSource:
        return "Published";
      default:
        return "Completed";
    }
  };

  const resolveNextAction = (
    item: AdminRecentActivityItem,
  ): { label: string; href: string } => {
    switch (item.actionKey) {
      case ADMIN_OVERVIEW_ACTION_KEYS.suspendedAccount:
      case ADMIN_OVERVIEW_ACTION_KEYS.restoredAccount:
      case ADMIN_OVERVIEW_ACTION_KEYS.invitedUser:
        return { label: "View user", href: "/admin/users" };
      case ADMIN_OVERVIEW_ACTION_KEYS.activatedLegalSource:
        return { label: "View source", href: "/admin/legal-sources" };
      default:
        return { label: "View event", href: "/admin/overview" };
    }
  };

  if (isLoading) {
    return (
      <div
        className={cn(
          "flex min-h-72 w-full flex-col justify-between rounded-xl border border-border bg-card p-5 shadow-xs",
          className,
        )}
      >
        <div className="space-y-1">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3.5 w-60" />
        </div>
        <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className={cn(
          "flex min-h-72 w-full flex-col items-center justify-center rounded-xl border border-border bg-card p-5 text-center shadow-xs",
          className,
        )}
      >
        <p className="text-sm font-semibold text-foreground">
          {resolveAppMessage(
            "pages.admin.overview.recentActivity.errorTitle" as MessageKey,
          )}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {resolveAppMessage(
            "pages.admin.overview.recentActivity.errorDescription" as MessageKey,
          )}
        </p>
        {onRetry ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="mt-4"
          >
            {resolveAppMessage("pages.admin.overview.retry" as MessageKey)}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      data-figma-node="1682:1761"
      data-figma-name="Data table / events"
      className={cn(
        "flex min-h-72 w-full flex-col justify-between rounded-xl border border-[#D6DFE7] bg-white p-5 shadow-xs",
        className,
      )}
    >
      {/* Section CardHeader */}
      <AdminSectionCardHeader
        title={title}
        description={subtitle}
        className="mb-3"
      />

      {/* Table Container */}
      <div className="mt-2 flex-1 overflow-x-auto rounded-lg border border-[#D6DFE7] bg-white">
        {items.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center p-6 text-center">
            <p className="text-xs font-medium text-[#101C29]">
              {resolveAppMessage(
                "pages.admin.overview.recentActivity.emptyTitle" as MessageKey,
              )}
            </p>
            <p className="text-xs text-[#48586A] mt-0.5">
              {resolveAppMessage(
                "pages.admin.overview.recentActivity.emptyDescription" as MessageKey,
              )}
            </p>
          </div>
        ) : (
          <div>
            {/* Table Header (#1711:9049) */}
            <div className="flex min-h-[38px] items-center bg-[#E8EEF3] px-4 text-xs font-semibold text-[#435367]">
              <div className="w-[280px] shrink-0">Assessment / event</div>
              <div className="w-[180px] shrink-0">Area</div>
              <div className="w-[160px] shrink-0">Status</div>
              <div className="w-[170px] shrink-0">Updated</div>
              <div className="flex-1 text-right">Next action</div>
            </div>

            {/* Table Rows (#1682:1255) */}
            <div className="divide-y divide-[#D6DFE7]">
              {items.slice(0, 6).map((item) => {
                const action = resolveNextAction(item);
                return (
                  <AdminEventsTableRow
                    key={item.id}
                    event={
                      item.target
                        ? item.target
                        : item.eventType || "Operational event"
                    }
                    area={resolveAreaLabel(item)}
                    statusBadge={
                      <AdminStatusBadge
                        label={resolveStatusLabel(item)}
                        variant={resolveStatusVariant(item)}
                      />
                    }
                    updated={formatLocaleActivityTime(item.occurredAt)}
                    nextActionLabel={action.label}
                    nextActionHref={action.href}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Table Footer / Pagination summary (#1711:9050) */}
      <div className="mt-3 flex items-center justify-between text-xs text-[#48586A]">
        <span>Showing {Math.min(items.length, 6)} recent events</span>
        <Link
          href="/admin/overview"
          className="inline-flex items-center gap-1 text-xs font-semibold text-[#11545B] hover:text-[#0b383d] transition-colors"
        >
          <span>View activity history</span>
          <span aria-hidden="true">›</span>
        </Link>
      </div>
    </div>
  );
}
