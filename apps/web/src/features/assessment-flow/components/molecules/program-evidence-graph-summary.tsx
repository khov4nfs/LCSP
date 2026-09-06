import { resolveMessage } from "@lcsp/i18n";
import { ArrowRightIcon, WaypointsIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

import type {
  ProgramEvidenceMetric,
  ProgramEvidenceSummary,
} from "../../types/assessment-flow.types";

type ProgramEvidenceGraphSummaryProps = {
  commitSha: string;
  summary: ProgramEvidenceSummary;
  referenceUrl?: string;
  className?: string;
};

export function ProgramEvidenceGraphSummary({
  commitSha,
  summary,
  referenceUrl,
  className,
}: ProgramEvidenceGraphSummaryProps) {
  const shortSha = commitSha.slice(0, 12);

  return (
    <article
      data-slot="program-evidence-graph-summary"
      className={cn(
        "w-full max-w-170 min-w-0 rounded-xl border border-border bg-card p-3 text-card-foreground shadow-sm",
        className,
      )}
    >
      <header className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span
            aria-hidden="true"
            className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-foreground"
          >
            <WaypointsIcon className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-5">
              {t("pages.assessmentFlow.graph.title")}
            </h3>
            <p className="mt-0.5 truncate text-xs leading-5 text-muted-foreground">
              {t("pages.assessmentFlow.graph.subtitle")} {shortSha}
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
          {t("pages.assessmentFlow.graph.ready")}
        </span>
      </header>

      <div className="mt-2.5 border-t border-border pt-2.5">
        <dl className="grid gap-x-5 gap-y-2.5 sm:grid-cols-2">
          <MetricItem
            label={t("pages.assessmentFlow.graph.servicesScanned")}
            description={t(
              "pages.assessmentFlow.graph.servicesScannedDescription",
            )}
            metric={summary.servicesScanned}
          />
          <MetricItem
            label={t("pages.assessmentFlow.graph.codeSymbolsIndexed")}
            description={t(
              "pages.assessmentFlow.graph.codeSymbolsIndexedDescription",
            )}
            metric={summary.codeSymbolsIndexed}
          />
          <MetricItem
            label={t("pages.assessmentFlow.graph.aiProviderCallPaths")}
            description={t(
              "pages.assessmentFlow.graph.aiProviderCallPathsDescription",
            )}
            metric={summary.aiProviderCallPaths}
          />
          <MetricItem
            label={t("pages.assessmentFlow.graph.evidenceMappedScope")}
            description={t(
              "pages.assessmentFlow.graph.evidenceMappedScopeDescription",
            )}
            metric={summary.evidenceMappedScope}
          />
        </dl>
      </div>

      <footer className="mt-2.5 flex min-w-0 items-center justify-between gap-3 border-t border-border pt-2.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!referenceUrl}
          className="h-8 min-w-0 px-0 text-sm font-medium"
        >
          {t("pages.assessmentFlow.graph.viewEvidenceGraph")}
          <ArrowRightIcon aria-hidden="true" className="size-4" />
        </Button>
        <p className="shrink-0 text-xs text-muted-foreground">
          {t("pages.assessmentFlow.graph.artifactMetadata")}
        </p>
      </footer>
    </article>
  );
}

function MetricItem({
  label,
  description,
  metric,
}: {
  label: string;
  description: string;
  metric: ProgramEvidenceMetric;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 text-xl font-semibold leading-6">
          {formatMetric(metric)}
        </span>
        <span className="min-w-0 text-sm font-medium leading-5">{label}</span>
      </dt>
      <dd className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
        {description}
      </dd>
    </div>
  );
}

function formatMetric(metric: ProgramEvidenceMetric) {
  if (metric.value === null) {
    return t("pages.assessmentFlow.graph.unavailableValue");
  }

  const rounded =
    metric.format === "percent" ? Math.round(metric.value) : metric.value;
  return metric.format === "percent" ? `${rounded}%` : rounded.toLocaleString();
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
