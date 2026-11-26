"use client";

import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import {
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import {
  TRACKING_TRUST_STATUSES,
  type CustomerTrackingAssessmentItem,
} from "@lcsp/contracts/assessment-domain";

import { CoverageProgress } from "@/components/molecules/coverage-progress";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { appLocale } from "@/lib/locale";
import {
  ASSESSMENT_LIST_STATUS_FILTERS,
  type AssessmentRowPresentation,
  type AssessmentRowProps,
} from "../../types/assessment-list.types";
import {
  formatTrackingDate,
  trackingMessage,
} from "../../utils/tracking-display";
import { AssessmentRowActions } from "./assessment-row-actions";

/**
 * Derives canonical status filter bucket, semantic badge style, coverage bar color,
 * and next-action link for a tracking assessment item.
 */
export function resolveAssessmentListPresentation(
  item: CustomerTrackingAssessmentItem,
): AssessmentRowPresentation {
  const baseHref = `/assessments/${encodeURIComponent(item.assessmentId)}`;

  if (item.pendingActionCount > 0) {
    return {
      statusFilter: ASSESSMENT_LIST_STATUS_FILTERS.needsInfo,
      statusLabel: trackingMessage("statusNeedsInfo"),
      badgeClassName:
        "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/50 dark:text-amber-200",
      progressColor: "var(--status-warning)",
      nextActionLabel: trackingMessage("nextActionAnswer"),
      href: baseHref,
    };
  }

  if (
    item.executionState === AGENT_EXECUTION_STATES.FAILED ||
    item.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.FAILED ||
    item.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.BLOCKED ||
    item.trust.trustStatus === TRACKING_TRUST_STATUSES.BLOCKED
  ) {
    return {
      statusFilter: ASSESSMENT_LIST_STATUS_FILTERS.failed,
      statusLabel: trackingMessage("statusFailed"),
      badgeClassName:
        "border-red-200 bg-red-50 text-red-800 dark:border-red-800/60 dark:bg-red-950/50 dark:text-red-200",
      progressColor: "var(--status-danger)",
      nextActionLabel: trackingMessage("nextActionReview"),
      href: baseHref,
    };
  }

  if (
    item.report.isReady ||
    item.executionState === AGENT_EXECUTION_STATES.SUCCEEDED ||
    item.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.COMPLETE
  ) {
    return {
      statusFilter: ASSESSMENT_LIST_STATUS_FILTERS.completed,
      statusLabel: trackingMessage("statusCompleted"),
      badgeClassName:
        "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/50 dark:text-emerald-200",
      progressColor: "var(--status-completed)",
      nextActionLabel: item.report.hasFinalReport
        ? trackingMessage("nextActionOpenReport")
        : trackingMessage("nextActionReview"),
      href: item.report.hasFinalReport ? `${baseHref}/report` : baseHref,
    };
  }

  if (
    item.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.CREATED ||
    item.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.PREPARING
  ) {
    return {
      statusFilter: ASSESSMENT_LIST_STATUS_FILTERS.draft,
      statusLabel: trackingMessage("statusDraft"),
      badgeClassName:
        "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
      progressColor: "var(--status-draft)",
      nextActionLabel: trackingMessage("nextActionProgress"),
      href: baseHref,
    };
  }

  return {
    statusFilter: ASSESSMENT_LIST_STATUS_FILTERS.running,
    statusLabel: trackingMessage("statusRunning"),
    badgeClassName:
      "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-800/60 dark:bg-indigo-950/50 dark:text-indigo-200",
    progressColor: "var(--status-running)",
    nextActionLabel: trackingMessage("nextActionProgress"),
    href: baseHref,
  };
}

/**
 * Single assessment table row matching Figma LCSP Data / Assessment list row (1688:3357).
 */
export function AssessmentRow({ item }: AssessmentRowProps) {
  const presentation = resolveAssessmentListPresentation(item);
  const concluded =
    item.compliance.compliantCount +
    item.compliance.nonCompliantCount +
    item.compliance.notApplicableCount;
  const total = concluded + item.compliance.unresolvedCount;
  const repoLabel =
    item.repository.owner && item.repository.name
      ? `${item.repository.owner}/${item.repository.name}`
      : item.repository.name ?? trackingMessage("notAvailable");

  return (
    <TableRow className="h-20" data-component="AssessmentRow">
      <TableCell className="max-w-80 pl-4">
        <Link
          href={presentation.href}
          className="block truncate text-sm font-semibold text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {item.name}
        </Link>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {repoLabel}
        </p>
      </TableCell>

      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
        {formatTrackingDate(item.updatedAt)}
      </TableCell>

      <TableCell>
        <CoverageProgress
          concluded={concluded}
          total={total}
          locale={appLocale}
          barColor={presentation.progressColor}
          stacked
        />
      </TableCell>

      <TableCell>
        <Badge variant="outline" className={presentation.badgeClassName}>
          {presentation.statusLabel}
        </Badge>
      </TableCell>

      <TableCell className="text-right">
        <div className="inline-flex items-center justify-end gap-3">
          <Link
            href={presentation.href}
            className="inline-flex items-center gap-0.5 text-xs font-medium text-brand-deep hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {presentation.nextActionLabel}
            <ChevronRightIcon className="size-3.5" aria-hidden="true" />
          </Link>
          <AssessmentRowActions
            assessmentId={item.assessmentId}
            assessmentName={item.name}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}
