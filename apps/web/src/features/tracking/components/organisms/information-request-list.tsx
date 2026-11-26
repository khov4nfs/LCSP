import { ChevronRightIcon, SearchIcon } from "lucide-react";

import { RequestStatusBadge } from "@/components/molecules/request-status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatLocaleDateTime } from "@/lib/date-format";
import { appLocale } from "@/lib/locale";

import { trackingMessage } from "../../utils/tracking-display";
import { TrackingEmptyState } from "../molecules/tracking-empty-state";
import { TrackingPagination } from "../molecules/tracking-pagination";

export const REQUEST_STATUS_FILTERS = {
  all: "all",
  open: "open",
  resolved: "resolved",
} as const;

export type RequestStatusFilter =
  (typeof REQUEST_STATUS_FILTERS)[keyof typeof REQUEST_STATUS_FILTERS];

export interface InformationRequestRow {
  requestId: string;
  assessmentId: string;
  assessmentName: string;
  assessmentRuleId: string;
  question: string;
  unresolvedFact: string;
  createdAt: string;
  open: boolean;
  destinationUrl: string;
}

/**
 * Business purpose: Render the `Request history` table (`Data table / requests` `1682:2979`) with search, status filter, `LCSP Data / Table row / requests` (`1682:1286`), and pagination.
 * Business rules:
 * - Filters and search are controlled by the parent dashboard so empty states and pagination stay synchronized.
 * - Open rows highlight `Needs information` (`RequestStatusBadge`) and `Answer`; resolved rows show `Completed` and `View answer`.
 * Execution flow:
 * 1. Render card header with `View all` reset action, search input, and status select.
 * 2. Render table header and rows (or `TrackingEmptyState` when empty).
 * 3. Render footer count and `TrackingPagination`.
 * Failure cases:
 * - Empty `rows` renders a clear empty state without broken table chrome.
 * Side effects:
 * - Invokes `onSelectRequest(row)` when a row action is activated.
 */
export function InformationRequestList({
  rows,
  totalCount,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  onViewAll,
  offset,
  limit,
  onPageChange,
  onSelectRequest,
}: {
  rows: readonly InformationRequestRow[];
  totalCount: number;
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: RequestStatusFilter;
  onStatusFilterChange: (value: RequestStatusFilter) => void;
  onViewAll: () => void;
  offset: number;
  limit: number;
  onPageChange: (nextOffset: number) => void;
  onSelectRequest: (row: InformationRequestRow) => void;
}) {
  const hasFilters =
    search.trim().length > 0 || statusFilter !== REQUEST_STATUS_FILTERS.all;

  return (
    <Card className="overflow-hidden rounded-xl border-border bg-card shadow-xs">
      <CardHeader className="gap-4 border-b border-border pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">
              {trackingMessage("requestsHistoryTitle")}
            </CardTitle>
            <CardDescription className="mt-1 text-xs">
              {trackingMessage("requestsHistorySubtitle")}
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasFilters}
            onClick={onViewAll}
          >
            {trackingMessage("requestsViewAll")}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-60 flex-1 sm:max-w-xs">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label={trackingMessage("requestsSearchPlaceholder")}
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={trackingMessage("requestsSearchPlaceholder")}
              className="h-9 pl-9"
            />
          </div>

          <Select
            value={statusFilter}
            onValueChange={(value) =>
              onStatusFilterChange(
                (value as RequestStatusFilter) ?? REQUEST_STATUS_FILTERS.all,
              )
            }
          >
            <SelectTrigger
              aria-label={trackingMessage("colStatus")}
              className="h-9 w-44"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={REQUEST_STATUS_FILTERS.all}>
                {trackingMessage("requestsAllStatuses")}
              </SelectItem>
              <SelectItem value={REQUEST_STATUS_FILTERS.open}>
                {trackingMessage("statusNeedsInfo")}
              </SelectItem>
              <SelectItem value={REQUEST_STATUS_FILTERS.resolved}>
                {trackingMessage("statusCompleted")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="p-6">
            <TrackingEmptyState>
              <span className="font-medium text-foreground">
                {trackingMessage("requestsEmptyTitle")}
              </span>{" "}
              <span>{trackingMessage("requestsEmptyBody")}</span>
            </TrackingEmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-160 border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-accent/60 text-xs font-semibold text-muted-foreground">
                  <th className="px-4 py-2.5">
                    {trackingMessage("requestsColQuestion")}
                  </th>
                  <th className="px-4 py-2.5">
                    {trackingMessage("colAssessment")}
                  </th>
                  <th className="px-4 py-2.5">
                    {trackingMessage("requestsColUpdated")}
                  </th>
                  <th className="px-4 py-2.5">{trackingMessage("colStatus")}</th>
                  <th className="px-4 py-2.5 text-right">
                    {trackingMessage("requestsColAction")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr
                    key={row.requestId}
                    className="transition-colors hover:bg-muted/35"
                  >
                    <td className="max-w-sm px-4 py-3 font-semibold text-foreground">
                      <p className="truncate" title={undefined}>
                        {row.unresolvedFact || row.question}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <p className="truncate">{row.assessmentName}</p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {formatLocaleDateTime(row.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <RequestStatusBadge open={row.open} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onSelectRequest(row)}
                        className="gap-1 font-medium text-brand-deep hover:text-brand"
                      >
                        <span>
                          {row.open
                            ? trackingMessage("requestsActionAnswer")
                            : trackingMessage("requestsActionViewAnswer")}
                        </span>
                        <ChevronRightIcon
                          className="size-3.5"
                          aria-hidden="true"
                        />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
          <p className="text-xs text-muted-foreground">
            {trackingMessage("requestsShowingCount")
              .replace("{shown}", rows.length.toLocaleString(appLocale))
              .replace("{total}", totalCount.toLocaleString(appLocale))}
          </p>
          <TrackingPagination
            total={totalCount}
            limit={limit}
            offset={offset}
            hasMore={offset + rows.length < totalCount}
            onOffsetChange={onPageChange}
          />
        </div>
      </CardContent>
    </Card>
  );
}
