"use client";
import { useAppLocale } from "@/components/providers/locale-provider";
import type { MessageKey } from "@lcsp/i18n";
import { resolveAppMessage } from "@/lib/i18n";
import {
  canonicalExecutionLabel,
  formatLocaleTimestamp,
} from "@/features/workspace/utils/assessment-runtime-formatter";
import {
  preparationFailure,
  preparationStages,
} from "../../utils/preparation-observability";
import type { PreparationObservabilityProps } from "../../types/preparation-observability.types";
/**
 * Business purpose: Keep the exact selected Preparation, stage evidence and safe operator diagnostics visible.
 * Business rules:
 * - Canonical execution/draft state is authoritative; missing telemetry, billing and costs remain explicitly unavailable.
 * Execution flow:
 * 1. Render pinned run/source/scope identity, evidence-backed stages and bounded failure metadata.
 * Failure cases:
 * - Unknown metadata is labeled NOT_REPORTED, never inferred from stream connectivity.
 * Side effects:
 * - None: read-only operations summary.
 */
export function PreparationObservability({
  run,
  events,
}: PreparationObservabilityProps) {
  useAppLocale();
  const t = (key: string) =>
    resolveAppMessage(`pages.preparationOps.${key}` as MessageKey);
  const unknown = t("notReported");
  const latest = [...events].sort((a, b) => b.sequence - a.sequence)[0];
  const failure = preparationFailure(events);
  const cells = [
    [t("runId"), run.preparationRunId],
    [t("source"), `${run.legalSourceVersion} / ${run.legalSourceVersionId}`],
    [t("scope"), run.targetActivityScope ?? unknown],
    [t("contract"), run.executionContract ?? unknown],
    [t("attempt"), String(run.attempt)],
    [t("state"), canonicalExecutionLabel(run.executionState)],
    [
      t("started"),
      run.startedAt ? formatLocaleTimestamp(run.startedAt) : unknown,
    ],
    [
      t("lastActivity"),
      latest ? formatLocaleTimestamp(latest.emittedAt) : unknown,
    ],
    [t("currentStage"), run.draft?.stage ?? run.claimPhase ?? unknown],
    [
      t("blockers"),
      run.persistedCoverageAvailable
        ? String(run.draft?.coverage.blocked ?? unknown)
        : unknown,
    ],
    [
      t("requirements"),
      run.persistedDraftAvailable
        ? String(run.draft?.requirementCount ?? unknown)
        : unknown,
    ],
    [
      t("rules"),
      run.persistedDraftAvailable
        ? String(run.draft?.assessmentRuleCount ?? unknown)
        : unknown,
    ],
    [t("retryPermitted"), run.retryable ? t("yes") : t("no")],
    [t("resumePermitted"), run.resumable ? t("yes") : t("no")],
  ];
  return (
    <section
      className="flex min-w-0 flex-col gap-3 rounded-lg border p-4"
      data-slot="preparation-observability"
    >
      <h3 className="font-semibold">{t("title")}</h3>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        {cells.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="wrap-break-word">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">{t("canonicalState")}</p>
      <ol className="grid gap-2 text-sm sm:grid-cols-2">
        {preparationStages(run, events).map((item) => (
          <li key={item.stage}>
            {t(`stages.${item.stage}`)}: {t(`statuses.${item.status}`)}
          </li>
        ))}
      </ol>
      {failure ? (
        <div role="alert" className="rounded-md border p-3 text-sm">
          <h4 className="font-semibold">{t("failure")}</h4>
          <dl className="grid gap-2 sm:grid-cols-2">
            {Object.entries(failure).map(([key, value]) => (
              <div key={key}>
                <dt>{t(`diagnostics.${key}`)}</dt>
                <dd className="wrap-break-word">{value || unknown}</dd>
              </div>
            ))}
          </dl>
          <p>
            {run.resumable
              ? t("resumeAction")
              : run.retryable
                ? t("retryAction")
                : t("inspectAction")}
          </p>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">{t("persistedCounts")}</p>
      <p className="text-xs text-muted-foreground">{t("billingUnavailable")}</p>
    </section>
  );
}
