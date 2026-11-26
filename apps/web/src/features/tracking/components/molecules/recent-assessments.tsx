"use client";

import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import {
  TRACKING_TRUST_STATUSES,
  type CustomerTrackingAssessmentItem,
  type TrackingPagination as TrackingPaginationData,
} from "@lcsp/contracts/assessment-domain";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { appLocale } from "@/lib/locale";
import { TrackingEmptyState } from "./tracking-empty-state";
import { TrackingPagination } from "./tracking-pagination";
import {
  formatTrackingDate,
  trackingMessage,
} from "../../utils/tracking-display";

type RecentAssessmentsProps = {
  assessments: readonly CustomerTrackingAssessmentItem[];
  pagination: TrackingPaginationData;
  onOffsetChange: (offset: number) => void;
};

type RowPresentation = {
  statusLabel: string;
  badgeClassName: string;
  nextActionLabel: string;
  href: string;
};

/**
 * Derives semantic status badge styling and contextual next-action link from canonical assessment fields.
 */
function resolveAssessmentRowPresentation(
  item: CustomerTrackingAssessmentItem,
): RowPresentation {
  const baseHref = `/assessments/${encodeURIComponent(item.assessmentId)}`;

  if (item.pendingActionCount > 0) {
    return {
      statusLabel: trackingMessage("statusNeedsInfo"),
      badgeClassName:
        "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/50 dark:text-amber-200",
      nextActionLabel: trackingMessage("nextActionAnswer"),
      href: baseHref,
    };
  }

  if (
    item.executionState === "FAILED" ||
    item.trust.trustStatus === TRACKING_TRUST_STATUSES.BLOCKED
  ) {
    return {
      statusLabel: trackingMessage("statusFailed"),
      badgeClassName:
        "border-red-200 bg-red-50 text-red-800 dark:border-red-800/60 dark:bg-red-950/50 dark:text-red-200",
      nextActionLabel: trackingMessage("nextActionReview"),
      href: baseHref,
    };
  }

  if (item.report.isReady || item.executionState === "COMPLETED") {
    return {
      statusLabel: trackingMessage("statusCompleted"),
      badgeClassName:
        "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/50 dark:text-emerald-200",
      nextActionLabel: trackingMessage("nextActionReview"),
      href: item.report.hasFinalReport ? `${baseHref}/report` : baseHref,
    };
  }

  return {
    statusLabel: trackingMessage("statusRunning"),
    badgeClassName:
      "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-800/60 dark:bg-indigo-950/50 dark:text-indigo-200",
    nextActionLabel: trackingMessage("nextActionProgress"),
    href: baseHref,
  };
}

/**
 * Business purpose:
 * Present recent workspace assessments in a scannable table with coverage ratio,
 * lifecycle status, and direct next-action links aligned with Figma 1682:1362.
 *
 * Business rules:
 * - Coverage displays concluded rules over total selected/evaluated rules (`evaluated / total`).
 * - Empty state guides users when no assessments exist or match filters.
 *
 * Execution flow:
 * 1. Render CardHeader with formula hint and View all link to `/assessments`.
 * 2. Render responsive table rows with coverage progress bar, semantic status badge, and next action.
 * 3. Render pagination controls when assessments exist.
 *
 * Failure cases:
 * - Zero-rule assessments render `0 / 0` with a 0% track rather than NaN.
 *
 * Side effects:
 * - Invokes `onOffsetChange` when user pages forward or backward.
 */
export function RecentAssessments({
  assessments,
  pagination,
  onOffsetChange,
}: RecentAssessmentsProps) {
  return (
    <Card
      className="overflow-hidden rounded-xl border-border bg-card shadow-xs"
      data-component="RecentAssessments"
    >
      <CardHeader className="border-b border-border/70 pb-4">
        <div>
          <CardTitle className="text-lg font-semibold tracking-tight">
            {trackingMessage("recentAssessmentsTableTitle")}
          </CardTitle>
          <CardDescription className="mt-0.5 text-xs">
            {trackingMessage("coverageFormulaHint")}
          </CardDescription>
        </div>
        <CardAction>
          <Button
            render={<Link href="/assessments" />}
            variant="outline"
            size="sm"
            nativeButton={false}
          >
            {trackingMessage("viewAll")}
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="p-0">
        {assessments.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="pl-4 font-semibold">
                      {trackingMessage("colAssessment")}
                    </TableHead>
                    <TableHead className="font-semibold">
                      {trackingMessage("colLastUpdated")}
                    </TableHead>
                    <TableHead className="font-semibold">
                      {trackingMessage("colCoverage")}
                    </TableHead>
                    <TableHead className="font-semibold">
                      {trackingMessage("colStatus")}
                    </TableHead>
                    <TableHead className="pr-4 text-right font-semibold">
                      {trackingMessage("colNextAction")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assessments.map((item) => {
                    const concluded =
                      item.compliance.compliantCount +
                      item.compliance.nonCompliantCount +
                      item.compliance.notApplicableCount;
                    const total = concluded + item.compliance.unresolvedCount;
                    const ratio =
                      total > 0 ? Math.min(100, (concluded / total) * 100) : 0;
                    const presentation = resolveAssessmentRowPresentation(item);

                    return (
                      <TableRow key={item.assessmentId}>
                        <TableCell className="max-w-64 truncate pl-4 font-semibold text-foreground">
                          <Link
                            href={presentation.href}
                            className="hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {item.name}
                          </Link>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatTrackingDate(item.updatedAt)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <span className="min-w-12 text-xs font-medium text-muted-foreground tabular-nums">
                              {concluded.toLocaleString(appLocale)} /{" "}
                              {total.toLocaleString(appLocale)}
                            </span>
                            <div
                              className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"
                              aria-hidden="true"
                            >
                              <div
                                className="h-full rounded-full bg-[#087f75] transition-[width] duration-300 motion-reduce:transition-none"
                                style={{ width: `${ratio}%` }}
                              />
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={presentation.badgeClassName}
                          >
                            {presentation.statusLabel}
                          </Badge>
                        </TableCell>
                        <TableCell className="pr-4 text-right">
                          <Link
                            href={presentation.href}
                            className="inline-flex items-center gap-1 text-sm font-medium text-[#11545b] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-emerald-300"
                          >
                            {presentation.nextActionLabel}
                            <ChevronRightIcon
                              className="size-3.5"
                              aria-hidden="true"
                            />
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 px-4 py-3">
              <p className="text-xs text-muted-foreground">
                {trackingMessage("showingRecords")
                  .replace("{shown}", assessments.length.toLocaleString(appLocale))
                  .replace("{total}", pagination.total.toLocaleString(appLocale))}
              </p>
              <TrackingPagination
                total={pagination.total}
                limit={pagination.limit}
                offset={pagination.offset}
                hasMore={pagination.hasMore}
                onOffsetChange={onOffsetChange}
                showTotal={false}
              />
            </div>
          </>
        ) : (
          <div className="p-4">
            <TrackingEmptyState>
              {trackingMessage("noAssessments")}
            </TrackingEmptyState>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
