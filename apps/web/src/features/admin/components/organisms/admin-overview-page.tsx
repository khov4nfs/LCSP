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
import { AdminUserStatusCard } from "../molecules/admin-user-status-card";
import { AdminRecentActivityCard } from "../molecules/admin-recent-activity-card";
import { AdminCorpusStatusCard } from "../molecules/admin-corpus-status-card";
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
  const currentCorpusLabel = resolveAppMessage(
    "pages.admin.overview.metrics.currentCorpus" as MessageKey,
  );
  const corpusSubtitleTemplate = resolveAppMessage(
    "pages.admin.overview.metrics.corpusSubtitle" as MessageKey,
  );
  const noCorpusLabel = resolveAppMessage(
    "pages.admin.overview.metrics.noCorpus" as MessageKey,
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

  const currentCorpusSubtitle = data
    ? data.summary.currentCorpus.version
      ? corpusSubtitleTemplate
          .replace("{sources}", String(data.summary.currentCorpus.sourceCount))
          .replace(
            "{rules}",
            data.summary.currentCorpus.ruleCount === null
              ? "—"
              : String(data.summary.currentCorpus.ruleCount),
          )
      : noCorpusLabel
    : "—";

  return (
    <div className="space-y-6">
      {/* Page Header with Period Selector */}
      <AdminPageHeader
        title={title}
        description={description}
        actionSlot={
          <AdminPeriodSelector
            selectedPeriod={selectedPeriod}
            onSelectPeriod={setSelectedPeriod}
            disabled={isLoading}
          />
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
          label={currentCorpusLabel}
          value={data ? (data.summary.currentCorpus.version ?? "—") : undefined}
          subtitle={currentCorpusSubtitle}
          isLoading={isLoading}
        />
      </div>

      {/* Row 2: Assessment Activity & User Account Status */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <AdminAssessmentActivityCard
            points={data?.assessmentActivity.points}
            totalCompleted={data?.assessmentActivity.totalCompleted}
            periodDays={periodDays}
            startDate={data?.assessmentActivity.startDate}
            endDate={data?.assessmentActivity.endDate}
            isLoading={isLoading}
            isError={isError}
            onRetry={() => void refetch()}
          />
        </div>
        <div className="lg:col-span-5">
          <AdminUserStatusCard
            distribution={data?.accountDistribution}
            isLoading={isLoading}
          />
        </div>
      </div>

      {/* Row 3: Recent Admin Activity & Corpus Status */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <AdminRecentActivityCard
            items={data?.recentActivity}
            isLoading={isLoading}
            isError={isError}
            onRetry={() => void refetch()}
          />
        </div>
        <div className="lg:col-span-4">
          <AdminCorpusStatusCard
            corpusStatus={data?.corpusStatus}
            isLoading={isLoading}
          />
        </div>
      </div>
    </div>
  );
}
