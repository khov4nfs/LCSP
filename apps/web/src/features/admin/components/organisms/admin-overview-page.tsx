"use client";

import { useState } from "react";
import type { MessageKey } from "@lcsp/i18n";
import {
  ADMIN_OVERVIEW_PERIODS,
  type AdminOverviewPeriod,
} from "@lcsp/contracts/auth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AdminOverviewMetricCard } from "../atoms/admin-overview-metric-card";
import { AdminPageHeader } from "../molecules/admin-page-header";
import { AdminPeriodSelector } from "../molecules/admin-period-selector";
import { AdminAssessmentActivityCard } from "../molecules/admin-assessment-activity-card";
import { AdminOperationalPrioritiesCard } from "../molecules/admin-operational-priorities-card";
import { AdminRecentActivityCard } from "../molecules/admin-recent-activity-card";
import { useAdminOverviewQuery } from "@/lib/api/admin-overview-queries";
import { resolveAppMessage } from "@/lib/i18n";

export function AdminOverviewPage() {
  const [selectedPeriod, setSelectedPeriod] = useState<AdminOverviewPeriod>(
    ADMIN_OVERVIEW_PERIODS.p30d,
  );

  const { data, isLoading, isError, error, refetch } =
    useAdminOverviewQuery(selectedPeriod);

  const title = resolveAppMessage("pages.admin.overview.title" as MessageKey);
  const description = resolveAppMessage(
    "pages.admin.overview.description" as MessageKey,
  );

  const totalUsersLabel = resolveAppMessage(
    "pages.admin.overview.metrics.totalUsers" as MessageKey,
  );
  const totalUsersSubtitleTemplate = resolveAppMessage(
    "pages.admin.overview.metrics.totalUsersSubtitle" as MessageKey,
  );
  const activeUsersLabel = resolveAppMessage(
    "pages.admin.overview.metrics.activeUsers" as MessageKey,
  );
  const activeUsersSubtitleTemplate = resolveAppMessage(
    "pages.admin.overview.metrics.activeUsersSubtitle" as MessageKey,
  );
  const assessmentsLabel = resolveAppMessage(
    "pages.admin.overview.metrics.assessments" as MessageKey,
  );
  const assessmentsSubtitleTemplate = resolveAppMessage(
    "pages.admin.overview.metrics.assessmentsSubtitle" as MessageKey,
  );
  const currentLegalSourceLabel = resolveAppMessage(
    "pages.admin.overview.metrics.currentLegalSource" as MessageKey,
  );
  const legalSourceSubtitleTemplate = resolveAppMessage(
    "pages.admin.overview.metrics.legalSourceSubtitle" as MessageKey,
  );
  const noLegalSourceLabel = resolveAppMessage(
    "pages.admin.overview.metrics.noLegalSource" as MessageKey,
  );

  const periodDays =
    data?.periodDays ??
    (selectedPeriod === ADMIN_OVERVIEW_PERIODS.p7d
      ? 7
      : selectedPeriod === ADMIN_OVERVIEW_PERIODS.p90d
        ? 90
        : 30);

  const totalUsersSubtitle = data
    ? totalUsersSubtitleTemplate
        .replace("{change}", String(data.summary.totalUsers.periodChange))
        .replace("{days}", String(periodDays))
    : "—";

  const activeUsersSubtitle = data
    ? activeUsersSubtitleTemplate.replace(
        "{percentage}",
        String(data.summary.activeUsers.percentageOfTotal),
      )
    : "—";

  const assessmentsSubtitle = data
    ? assessmentsSubtitleTemplate.replace(
        "{completed}",
        String(data.summary.assessments.periodCompletedCount),
      )
    : "—";

  const currentLegalSourceSubtitle = data
    ? data.summary.currentLegalSource.version
      ? legalSourceSubtitleTemplate
          .replace("{sources}", String(data.summary.currentLegalSource.sourceCount))
          .replace(
            "{rules}",
            data.summary.currentLegalSource.ruleCount === null
              ? "—"
              : String(data.summary.currentLegalSource.ruleCount),
          )
      : noLegalSourceLabel
    : "—";

  return (
    <div
      data-figma-node="1662:3505"
      data-figma-name="42 Admin · Overview"
      className="space-y-6"
    >
      {/* Page Header with Period Selector & Quick Actions */}
      <AdminPageHeader
        title={title}
        description={description}
        actionSlot={
          <div className="flex items-center gap-3">
            <AdminPeriodSelector
              selectedPeriod={selectedPeriod}
              onSelectPeriod={setSelectedPeriod}
              disabled={isLoading}
            />
          </div>
        }
      />

      {/* Error Banner */}
      {isError ? (
        <Alert variant="destructive">
          <AlertTitle>
            {resolveAppMessage("pages.admin.overview.error" as MessageKey)}
          </AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>
              {error instanceof Error
                ? error.message
                : resolveAppMessage("pages.admin.overview.error" as MessageKey)}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
              className="ml-4"
            >
              {resolveAppMessage("pages.admin.overview.retry" as MessageKey)}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Row 1: Four Summary Metric Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AdminOverviewMetricCard
          label={totalUsersLabel}
          value={data ? data.summary.totalUsers.count : undefined}
          subtitle={totalUsersSubtitle}
          isLoading={isLoading}
        />
        <AdminOverviewMetricCard
          label={activeUsersLabel}
          value={data ? data.summary.activeUsers.count : undefined}
          subtitle={activeUsersSubtitle}
          isLoading={isLoading}
        />
        <AdminOverviewMetricCard
          label={assessmentsLabel}
          value={data ? data.summary.assessments.totalCount : undefined}
          subtitle={assessmentsSubtitle}
          isLoading={isLoading}
        />
        <AdminOverviewMetricCard
          label={currentLegalSourceLabel}
          value={data ? (data.summary.currentLegalSource.version ?? "—") : undefined}
          subtitle={currentLegalSourceSubtitle}
          isLoading={isLoading}
        />
      </div>

      {/* Row 2: Dashboard / Chart and Priority Queue (#1712:8274) */}
      <div
        data-figma-node="1712:8274"
        data-figma-name="Dashboard / Chart and priority queue"
        className="grid grid-cols-1 gap-6 lg:grid-cols-12"
      >
        {/* Left: Operational Priorities (#1682:1743) */}
        <div className="lg:col-span-5">
          <AdminOperationalPrioritiesCard
            totalExceptions={data ? 18 : undefined}
            totalLegalSources={data?.legalSourceStatus.current?.sourceCount ?? 184}
          />
        </div>

        {/* Right: Assessment Throughput (#1682:1714) */}
        <div className="lg:col-span-7">
          <AdminAssessmentActivityCard
            points={data?.assessmentActivity.points}
            totalCompleted={data?.assessmentActivity.totalCompleted}
            totalStarted={data?.assessmentActivity.totalStarted}
            totalUsersCount={data?.summary.totalUsers.count}
            periodDays={periodDays}
            startDate={data?.assessmentActivity.startDate}
            endDate={data?.assessmentActivity.endDate}
            isLoading={isLoading}
            isError={isError}
            onRetry={() => void refetch()}
          />
        </div>
      </div>

      {/* Row 3: Recent Operational Activity Events (#1682:1761) */}
      <div className="grid grid-cols-1 gap-6">
        <AdminRecentActivityCard
          items={data?.recentActivity}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => void refetch()}
        />
      </div>
    </div>
  );
}
