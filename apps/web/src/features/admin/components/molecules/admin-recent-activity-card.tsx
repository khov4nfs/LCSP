import type { MessageKey } from "@lcsp/i18n";
import {
  ADMIN_OVERVIEW_ACTION_KEYS,
  type AdminRecentActivityItem,
} from "@lcsp/contracts/auth";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type AdminRecentActivityCardProps = {
  items?: AdminRecentActivityItem[];
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  className?: string;
};

function formatOccurredTime(occurredAt: string): string {
  if (!occurredAt) return "—";
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) return occurredAt;

  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const timeStr = `${hours}:${minutes}`;

  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${month}/${day} ${timeStr}`;
}

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
  const tableAria = resolveAppMessage(
    "pages.admin.overview.recentActivity.tableAria" as MessageKey,
  );
  const timeHeader = resolveAppMessage(
    "pages.admin.overview.recentActivity.columns.time" as MessageKey,
  );
  const adminHeader = resolveAppMessage(
    "pages.admin.overview.recentActivity.columns.admin" as MessageKey,
  );
  const actionHeader = resolveAppMessage(
    "pages.admin.overview.recentActivity.columns.action" as MessageKey,
  );
  const targetHeader = resolveAppMessage(
    "pages.admin.overview.recentActivity.columns.target" as MessageKey,
  );

  const systemActorText = resolveAppMessage(
    "pages.admin.overview.recentActivity.systemActor" as MessageKey,
  );

  const resolveActionLabel = (item: AdminRecentActivityItem): string => {
    switch (item.actionKey) {
      case ADMIN_OVERVIEW_ACTION_KEYS.suspendedAccount:
        return resolveAppMessage(
          "pages.admin.overview.recentActivity.actions.suspendedAccount" as MessageKey,
        );
      case ADMIN_OVERVIEW_ACTION_KEYS.restoredAccount:
        return resolveAppMessage(
          "pages.admin.overview.recentActivity.actions.restoredAccount" as MessageKey,
        );
      case ADMIN_OVERVIEW_ACTION_KEYS.invitedUser:
        return resolveAppMessage(
          "pages.admin.overview.recentActivity.actions.invitedUser" as MessageKey,
        );
      case ADMIN_OVERVIEW_ACTION_KEYS.publishedCorpus:
        return resolveAppMessage(
          "pages.admin.overview.recentActivity.actions.publishedCorpus" as MessageKey,
        );
      case ADMIN_OVERVIEW_ACTION_KEYS.discardedDraft:
        return resolveAppMessage(
          "pages.admin.overview.recentActivity.actions.discardedDraft" as MessageKey,
        );
      default:
        return actionHeader;
    }
  };

  const resolveTargetLabel = (item: AdminRecentActivityItem): string => {
    if (item.target) return item.target;

    switch (item.actionKey) {
      case ADMIN_OVERVIEW_ACTION_KEYS.suspendedAccount:
      case ADMIN_OVERVIEW_ACTION_KEYS.restoredAccount:
        return resolveAppMessage(
          "pages.admin.overview.recentActivity.targets.userAccount" as MessageKey,
        );
      case ADMIN_OVERVIEW_ACTION_KEYS.invitedUser:
        return resolveAppMessage(
          "pages.admin.overview.recentActivity.targets.newUser" as MessageKey,
        );
      case ADMIN_OVERVIEW_ACTION_KEYS.discardedDraft:
        return resolveAppMessage(
          "pages.admin.overview.recentActivity.targets.corpusDraft" as MessageKey,
        );
      case ADMIN_OVERVIEW_ACTION_KEYS.publishedCorpus:
        return resolveAppMessage(
          "pages.admin.overview.recentActivity.targets.corpusVersion" as MessageKey,
        );
      default:
        return "—";
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
      className={cn(
        "flex min-h-72 w-full flex-col justify-between rounded-xl border border-border bg-card p-5 shadow-xs",
        className,
      )}
    >
      {/* Header */}
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
      </div>

      {/* Table Container */}
      <div className="mt-3 flex-1 overflow-hidden rounded-lg border border-border bg-background/50">
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-6 text-center">
            <p className="text-xs font-medium text-foreground">
              {resolveAppMessage(
                "pages.admin.overview.recentActivity.emptyTitle" as MessageKey,
              )}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {resolveAppMessage(
                "pages.admin.overview.recentActivity.emptyDescription" as MessageKey,
              )}
            </p>
          </div>
        ) : (
          <div className="max-h-48 overflow-y-auto">
            <Table aria-label={tableAria}>
              <TableHeader className="bg-muted/40 sticky top-0">
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="h-8 w-28 px-3 text-[10.5px] font-semibold text-muted-foreground uppercase">
                    {timeHeader}
                  </TableHead>
                  <TableHead className="h-8 px-3 text-[10.5px] font-semibold text-muted-foreground uppercase">
                    {adminHeader}
                  </TableHead>
                  <TableHead className="h-8 px-3 text-[10.5px] font-semibold text-muted-foreground uppercase">
                    {actionHeader}
                  </TableHead>
                  <TableHead className="h-8 px-3 text-[10.5px] font-semibold text-muted-foreground uppercase">
                    {targetHeader}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.slice(0, 4).map((item) => (
                  <TableRow
                    key={item.id}
                    className="border-border/60 hover:bg-muted/30 text-xs"
                  >
                    <TableCell className="px-3 py-2.5 font-medium text-foreground whitespace-nowrap">
                      {formatOccurredTime(item.occurredAt)}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-muted-foreground truncate max-w-40">
                      {item.adminEmail ?? item.adminName ?? systemActorText}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-muted-foreground truncate max-w-40">
                      {resolveActionLabel(item)}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-muted-foreground truncate max-w-44">
                      {resolveTargetLabel(item)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
