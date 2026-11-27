"use client";

import * as React from "react";
import type { MessageKey } from "@lcsp/i18n";
import { resolveAppMessage } from "@/lib/i18n";
import { formatLocaleDateTime } from "@/lib/date-format";
import type { AdminUsageSummaryProps } from "@/features/admin/types/admin.types";
import { AdminMetricCard } from "@/features/admin/components/atoms/admin-metric-card";

export function AdminUsageSummary({ usageSummary }: AdminUsageSummaryProps) {
  const sectionTitle = resolveAppMessage(
    "pages.admin.userDetail.usageSummary.title" as MessageKey,
  );
  const assessments30dLabel = resolveAppMessage(
    "pages.admin.userDetail.usageSummary.metrics.assessments30d" as MessageKey,
  );
  const lastAssessmentLabel = resolveAppMessage(
    "pages.admin.userDetail.usageSummary.metrics.lastAssessment" as MessageKey,
  );
  const creditSpend30dLabel = resolveAppMessage(
    "pages.admin.userDetail.usageSummary.metrics.creditSpend30d" as MessageKey,
  );
  const openFindingsLabel = resolveAppMessage(
    "pages.admin.userDetail.usageSummary.metrics.openFindings" as MessageKey,
  );

  const formatAssessments =
    usageSummary?.assessments30d !== null && usageSummary?.assessments30d !== undefined
      ? String(usageSummary.assessments30d)
      : "0";

  const formatLastAssessment = usageSummary?.lastAssessmentAt
    ? formatLocaleDateTime(usageSummary.lastAssessmentAt)
    : "—";

  const formatCreditSpend =
    usageSummary?.creditSpend30d !== null && usageSummary?.creditSpend30d !== undefined
      ? `₫${usageSummary.creditSpend30d.toLocaleString()}M`
      : "₫0";

  const formatFindings =
    usageSummary?.openFindingsCount !== null && usageSummary?.openFindingsCount !== undefined
      ? String(usageSummary.openFindingsCount)
      : "0";

  const cards = [
    {
      label: assessments30dLabel,
      value: formatAssessments,
      context: `${formatAssessments} completed`,
    },
    {
      label: lastAssessmentLabel,
      value: formatLastAssessment,
      context: "Latest execution",
    },
    {
      label: creditSpend30dLabel,
      value: formatCreditSpend,
      context: "Last 30 days usage",
    },
    {
      label: openFindingsLabel,
      value: formatFindings,
      context: "Review assessment results",
    },
  ];

  return (
    <section
      data-figma-node="1697:4584"
      data-figma-name="Usage summary"
      className="flex flex-col space-y-3 pt-2"
      aria-label={sectionTitle}
    >
      <h2 className="text-[19px] font-semibold text-foreground tracking-tight">
        {sectionTitle}
      </h2>

      {/* KPI grid / 4 columns (Figma 1712:8272) */}
      <div
        data-figma-node="1712:8272"
        data-figma-name="KPI grid / 4 columns"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {cards.map((card) => (
          <div
            key={card.label}
            className="flex h-[104px] flex-col justify-between rounded-[12px] border border-border bg-card p-4 shadow-xs"
          >
            <span className="text-[13px] font-semibold text-foreground">
              {card.label}
            </span>
            <span className="text-[26px] font-semibold leading-none text-primary tracking-tight">
              {card.value}
            </span>
            <span className="text-[12px] text-muted-foreground truncate">
              {card.context}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
