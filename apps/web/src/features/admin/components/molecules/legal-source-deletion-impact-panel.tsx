import type { LegalSourceDeletionImpactProps } from "../../types/legal-source-lifecycle.types";
import { resolveAppMessage as t } from "@/lib/i18n";
import { formatLocaleDateTimeWithYear } from "@/lib/date-format";
import { LEGAL_SOURCE_LIFECYCLE_STATUSES } from "@lcsp/contracts/legal-source";

/**
 * Business purpose: Make permanent deletion scope, protected references and retained evidence reviewable.
 * Business rules: Counts and blockers are server snapshot facts; this preview never grants deletion authority.
 * Execution flow:
 * 1. Display cascade counts, active versions, protected assessment references and retained snapshots.
 * 2. Display all server blockers and the exact snapshot timestamp.
 * Failure cases: A blocked snapshot stays blocked; missing or failed queries are handled by the dialog before this panel is rendered.
 * Side effects: Read-only rendering; no source or audit changes.
 */
export function LegalSourceDeletionImpactPanel({
  impact,
}: LegalSourceDeletionImpactProps) {
  const rows = [
    ["pages.legalSources.versionsTitle", impact.versionCounts.total],
    [
      "pages.legalLifecycle.activeVersion",
      impact.versionCounts.byStatus[LEGAL_SOURCE_LIFECYCLE_STATUSES.active],
    ],
    ["pages.legalLifecycle.documents", impact.cascade.documents],
    ["pages.legalLifecycle.chunks", impact.cascade.chunks],
    [
      "pages.legalLifecycle.assessments",
      impact.versions.reduce((sum, v) => sum + v.references.assessments, 0),
    ],
    ["pages.legalLifecycle.ruleSets", impact.cascade.ruleSetVersions],
    ["pages.legalLifecycle.preparations", impact.cascade.preparationRuns],
    ["pages.legalLifecycle.snapshots", impact.retention.independentSnapshots],
  ] as const;
  return (
    <section
      className="space-y-3 rounded-lg border p-4"
      aria-label={t("pages.legalLifecycle.impact")}
    >
      <h3 className="font-semibold">{t("pages.legalLifecycle.impact")}</h3>
      <p className="text-xs text-muted-foreground">
        {t("pages.legalLifecycle.preflight")}
      </p>
      <dl className="divide-y text-sm">
        {rows.map(([key, count]) => (
          <div
            key={key}
            className="flex items-center justify-between gap-3 py-2"
          >
            <dt>{t(key)}</dt>
            <dd className="font-medium tabular-nums">{count}</dd>
          </div>
        ))}
      </dl>
      <p className="break-all text-xs text-muted-foreground">
        {t("pages.legalLifecycle.snapshot")}:{" "}
        {formatLocaleDateTimeWithYear(impact.snapshot.generatedAt)}
      </p>
      <p className="text-xs">{t("pages.legalLifecycle.auditPreserved")}</p>
      {impact.eligibility.blockers.length ? (
        <ul
          className="list-disc pl-4 text-sm text-destructive"
          aria-label={t("pages.legalSources.deletionBlockers")}
        >
          {impact.eligibility.blockers.map((b) => (
            <li key={b}>
              {t(`pages.legalSources.deletionBlockerLabels.${b}`)}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
