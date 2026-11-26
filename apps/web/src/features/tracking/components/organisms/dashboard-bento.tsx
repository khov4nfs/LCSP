"use client";

import {
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import {
  TRACKING_RULE_OUTCOMES,
  TRACKING_TRUST_STATUSES,
  type CustomerTrackingOverview,
} from "@lcsp/contracts/assessment-domain";

import { CoverageDonut } from "@/components/molecules/coverage-donut";
import { NextMetricCard } from "@/components/molecules/next-metric-card";
import { OutcomeLegend } from "@/components/molecules/outcome-legend";
import {
  DASHBOARD_SURFACES,
  NEXT_METRIC_VARIANTS,
} from "@/components/types/dashboard-primitives.types";
import { appLocale } from "@/lib/locale";
import { ActionCenter } from "../molecules/action-center";
import { RecentAssessments } from "../molecules/recent-assessments";
import { trackingMessage } from "../../utils/tracking-display";

type DashboardBentoProps = {
  overview: CustomerTrackingOverview;
  reportsReadyCount: number;
  onOffsetChange: (offset: number) => void;
};

/**
 * Business purpose:
 * Render the Midnight-Teal bento intelligence grid combining aggregate rule coverage,
 * interactive assessment counters, the priority Action Center, and the Recent Assessments table.
 *
 * Business rules:
 * - All donut segments, legend percentages, and metric counts must reconcile strictly with
 *   `overview.complianceSummary`, `overview.assessments`, `overview.actions`, and `reportsReadyCount`.
 * - Zero-evaluation workspaces render a 0% neutral donut ring without NaN values.
 *
 * Execution flow:
 * 1. Compute outcome breakdown segments and denominator from `overview.complianceSummary`.
 * 2. Compute assessment completion, active, awaiting, and failed counts from `overview.assessments`.
 * 3. Render the 12-column bento grid (7-col Midnight-Teal coverage card + 5-col Action Center)
 *    followed by RecentAssessments.
 *
 * Failure cases:
 * - Handles empty assessments and zero evaluated rules gracefully without division-by-zero.
 *
 * Side effects:
 * - Delegates pagination changes via `onOffsetChange`.
 */
export function DashboardBento({
  overview,
  reportsReadyCount,
  onOffsetChange,
}: DashboardBentoProps) {
  const { complianceSummary, assessments, actions, pagination } = overview;

  const evaluatedSum =
    complianceSummary.compliantCount +
    complianceSummary.nonCompliantCount +
    complianceSummary.notApplicableCount +
    complianceSummary.unresolvedCount;
  const denominator = Math.max(
    complianceSummary.totalRulesEvaluated,
    evaluatedSum,
  );
  const notEvaluatedCount = Math.max(0, denominator - evaluatedSum);
  const resultsReadyCount =
    complianceSummary.compliantCount + complianceSummary.nonCompliantCount;

  const segments = [
    {
      key: TRACKING_RULE_OUTCOMES.COMPLIANT,
      label: trackingMessage("outcome.COMPLIANT"),
      count: complianceSummary.compliantCount,
      color: "var(--outcome-compliant)",
    },
    {
      key: TRACKING_RULE_OUTCOMES.NON_COMPLIANT,
      label: trackingMessage("outcome.NON_COMPLIANT"),
      count: complianceSummary.nonCompliantCount,
      color: "var(--outcome-non-compliant)",
    },
    {
      key: TRACKING_RULE_OUTCOMES.UNRESOLVED,
      label: trackingMessage("outcome.UNRESOLVED"),
      count: complianceSummary.unresolvedCount,
      color: "var(--outcome-unresolved)",
    },
    {
      key: TRACKING_RULE_OUTCOMES.NOT_APPLICABLE,
      label: trackingMessage("outcome.NOT_APPLICABLE"),
      count: complianceSummary.notApplicableCount,
      color: "var(--outcome-not-applicable)",
    },
    {
      key: "notEvaluated",
      label: trackingMessage("notEvaluated"),
      count: notEvaluatedCount,
      color: "var(--outcome-not-evaluated)",
    },
  ];

  const totalAssessments = Math.max(pagination.total, assessments.length);
  const completedAssessments = assessments.filter(
    (item) =>
      item.executionState === AGENT_EXECUTION_STATES.SUCCEEDED ||
      item.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.COMPLETE ||
      item.report.isReady,
  ).length;
  const notCompletedAssessments = Math.max(
    0,
    totalAssessments - completedAssessments,
  );
  const runningAssessments = assessments.filter(
    (item) =>
      item.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.ACTIVE ||
      item.executionState === AGENT_EXECUTION_STATES.RUNNING,
  ).length;
  const awaitingInputAssessments = assessments.filter(
    (item) => item.pendingActionCount > 0,
  ).length;
  const activeAssessments = runningAssessments + awaitingInputAssessments;
  const failedAssessments = assessments.filter(
    (item) =>
      item.executionState === AGENT_EXECUTION_STATES.FAILED ||
      item.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.BLOCKED ||
      item.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.FAILED ||
      item.trust.trustStatus === TRACKING_TRUST_STATUSES.BLOCKED,
  );

  const openRequestsCount = overview.actionsPagination?.total ?? actions.length;

  return (
    <div className="flex flex-col gap-6" data-component="DashboardBento">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <section
          aria-label={trackingMessage("coverageCardTitle")}
          className="flex flex-col justify-between gap-5 rounded-2xl bg-linear-to-r from-bento-from to-bento-to p-5 text-white shadow-md lg:col-span-7"
        >
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-bento-heading">
              {trackingMessage("coverageCardTitle")}
            </h2>
            <p className="mt-0.5 text-sm text-bento-muted">
              {trackingMessage("coverageCardSubtitle").replace(
                "{count}",
                denominator.toLocaleString(appLocale),
              )}
            </p>
          </div>

          <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
            <CoverageDonut
              segments={segments}
              total={denominator}
              centerValue={
                denominator > 0
                  ? resultsReadyCount.toLocaleString(appLocale)
                  : "0"
              }
              centerLabel={
                denominator > 0
                  ? trackingMessage("coverageResultsReady")
                  : trackingMessage("coverageEmptyTitle")
              }
              surface={DASHBOARD_SURFACES.dark}
            />

            <div
              className="hidden h-40 w-px shrink-0 bg-bento-border sm:block"
              aria-hidden="true"
            />

            <div className="w-full min-w-0 flex-1">
              <OutcomeLegend
                items={segments}
                denominator={denominator}
                surface={DASHBOARD_SURFACES.dark}
                locale={appLocale}
              />
            </div>
          </div>

          <div className="border-t border-bento-divider pt-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <NextMetricCard
                variant={NEXT_METRIC_VARIANTS.embedded}
                label={trackingMessage("assessmentsMetricLabel")}
                value={totalAssessments.toLocaleString(appLocale)}
                context={trackingMessage("assessmentsMetricContext")
                  .replace("{completed}", completedAssessments.toLocaleString(appLocale))
                  .replace(
                    "{notCompleted}",
                    notCompletedAssessments.toLocaleString(appLocale),
                  )}
                href="/assessments"
              />
              <NextMetricCard
                variant={NEXT_METRIC_VARIANTS.embedded}
                label={trackingMessage("activeAssessmentsMetricLabel")}
                value={activeAssessments.toLocaleString(appLocale)}
                context={trackingMessage("activeAssessmentsMetricContext")
                  .replace("{running}", runningAssessments.toLocaleString(appLocale))
                  .replace(
                    "{awaiting}",
                    awaitingInputAssessments.toLocaleString(appLocale),
                  )}
                href="/assessments"
              />
            </div>
          </div>
        </section>

        <div className="lg:col-span-5">
          <ActionCenter
            actions={actions}
            failedAssessments={failedAssessments}
            openRequestsCount={openRequestsCount}
            reportsReadyCount={reportsReadyCount}
          />
        </div>
      </div>

      <RecentAssessments
        assessments={assessments.slice(0, 5)}
        pagination={pagination}
        onOffsetChange={onOffsetChange}
      />
    </div>
  );
}
