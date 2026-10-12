"use client";

import type { MessageKey } from "@lcsp/i18n";
import { resolveAppMessage } from "@/lib/i18n";
import type { AdminUsageSummaryProps } from "@/features/admin/types/admin.types";
import { AdminMetricCard } from "@/features/admin/components/atoms/admin-metric-card";

function formatTimestamp(isoString: string | null | undefined): string {
  if (!isoString) return "—";
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function AdminUsageSummary({ usageSummary }: AdminUsageSummaryProps) {
  const sectionTitle = resolveAppMessage(
    "pages.admin.userDetail.usageSummary.title" as MessageKey,
  );
  const sectionDescription = resolveAppMessage(
    "pages.admin.userDetail.usageSummary.description" as MessageKey,
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
      : "—";

  const formatLastAssessment = formatTimestamp(usageSummary?.lastAssessmentAt);

  const formatCreditSpend =
    usageSummary?.creditSpend30d !== null && usageSummary?.creditSpend30d !== undefined
      ? `$${usageSummary.creditSpend30d.toFixed(2)}`
      : "—";

  const formatFindings =
    usageSummary?.openFindingsCount !== null && usageSummary?.openFindingsCount !== undefined
      ? String(usageSummary.openFindingsCount)
      : "—";

  const cards = [
    { label: assessments30dLabel, value: formatAssessments, widthClass: "w-full sm:w-[260px]" },
    { label: lastAssessmentLabel, value: formatLastAssessment, widthClass: "w-full sm:w-[260px]" },
    { label: creditSpend30dLabel, value: formatCreditSpend, widthClass: "w-full sm:w-[260px]" },
    { label: openFindingsLabel, value: formatFindings, widthClass: "w-full sm:w-[266px]" },
  ];

  return (
    <section className="flex flex-col space-y-4 pt-8" aria-label={sectionTitle}>
      <div className="flex flex-col">
        <h2 className="text-[15px] font-semibold text-foreground">{sectionTitle}</h2>
        <p className="text-[11.5px] text-muted-foreground">{sectionDescription}</p>
      </div>

      <div className="flex flex-wrap items-center gap-[22px]">
        {cards.map((card) => (
          <AdminMetricCard
            key={card.label}
            label={card.label}
            value={card.value}
            widthClass={card.widthClass}
          />
        ))}
      </div>
    </section>
  );
}
