"use client";

import {
  formatClassificationRuntimeSummary,
  formatEngineeringConcept,
  formatEngineeringLimitation,
  formatLegalReference,
  resolveClassificationRuntimeMessage,
  resolveMessage,
} from "@lcsp/i18n";
import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusCard } from "@/components/organisms/status-card";
import { getClassificationActionVisibility } from "@/lib/api/classification-client";
import { useClassificationStatusQuery } from "@/lib/api/assessment-queries";
import { appLocale } from "@/lib/locale";
import type { ClassificationStatusPageProps } from "../../types/component-props.types";
import type { EngineeringRuleEvaluationViewModel } from "@/lib/api/classification-client";

export function ClassificationStatusPage({
  assessmentId,
}: ClassificationStatusPageProps) {
  const router = useRouter();
  const statusQuery = useClassificationStatusQuery(assessmentId);

  useEffect(() => {
    if (statusQuery.data?.kind === "redirect") {
      router.replace(statusQuery.data.location);
    }
  }, [router, statusQuery.data]);

  const headingDescription = useMemo(
    () => resolveMessage(appLocale, "pages.classification.pageDescription"),
    [],
  );

  if (statusQuery.isLoading) {
    return (
      <PageShell description={headingDescription}>
        <StatusCard
          title={resolveMessage(appLocale, "pages.classification.pageTitle")}
          description={resolveMessage(appLocale, "pages.classification.loading")}
          badgeLabel={resolveMessage(
            appLocale,
            "pages.classification.states.processingBadge",
          )}
          badgeVariant="secondary"
        >
          <div className="py-2 text-sm text-muted-foreground">
            {resolveMessage(appLocale, "pages.classification.loading")}
          </div>
        </StatusCard>
      </PageShell>
    );
  }

  const viewModel =
    statusQuery.data?.kind === "loaded" ? statusQuery.data.data : null;
  const error =
    statusQuery.data?.kind === "error"
      ? resolveMessage(appLocale, statusQuery.data.titleKey)
      : null;

  if (error || !viewModel) {
    return (
      <PageShell description={headingDescription}>
        <Alert variant="destructive">
          <AlertTitle>
            {resolveMessage(appLocale, "pages.classification.errorTitle")}
          </AlertTitle>
          <AlertDescription>
            {error ??
              resolveMessage(appLocale, "pages.classification.errorDetail")}
          </AlertDescription>
        </Alert>
      </PageShell>
    );
  }

  const state = viewModel.state;
  const actionVisibility = getClassificationActionVisibility(viewModel);
  const directDescription = viewModel.engineeringSummary
    ? directRuntimeDescription(state)
    : resolveMessage(appLocale, viewModel.descriptionKey);
  const summary = viewModel.engineeringSummary
    ? formatClassificationRuntimeSummary(appLocale, viewModel.engineeringSummary)
    : viewModel.summaryKey
      ? resolveMessage(appLocale, viewModel.summaryKey)
      : null;

  return (
    <PageShell description={headingDescription}>
      <StatusCard
        title={resolveMessage(appLocale, viewModel.titleKey)}
        description={directDescription}
        badgeLabel={resolveMessage(appLocale, viewModel.badgeKey)}
        badgeVariant={state === "blocked" ? "destructive" : "secondary"}
      >
        {summary ? (
          <div className="rounded-lg border bg-muted/40 p-4">
            <p className="text-sm font-medium">
              {resolveMessage(appLocale, "pages.classification.summaryLabel")}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">{summary}</p>
          </div>
        ) : null}

        {viewModel.engineeringSummary ? (
          <div className="grid gap-3 sm:grid-cols-4">
            <Metric
              value={viewModel.engineeringSummary.total}
              label={resolveClassificationRuntimeMessage(appLocale, "metricTotal")}
            />
            <Metric
              value={viewModel.engineeringSummary.compliant}
              label={resolveClassificationRuntimeMessage(
                appLocale,
                "metricCompliant",
              )}
            />
            <Metric
              value={viewModel.engineeringSummary.nonCompliant}
              label={resolveClassificationRuntimeMessage(
                appLocale,
                "metricNonCompliant",
              )}
            />
            <Metric
              value={viewModel.engineeringSummary.unknown}
              label={resolveClassificationRuntimeMessage(appLocale, "metricUnknown")}
            />
          </div>
        ) : null}

        {viewModel.limitations.length ? (
          <div className="rounded-lg border bg-muted/20 p-4">
            <p className="text-sm font-medium">
              {resolveClassificationRuntimeMessage(appLocale, "limitations")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {viewModel.limitations.map((limitation) => (
                <span
                  key={limitation}
                  className="rounded-md border bg-background px-2.5 py-1.5 text-xs text-muted-foreground"
                  title={limitation}
                >
                  {formatEngineeringLimitation(appLocale, limitation)}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {viewModel.evaluations.length ? (
          <div className="grid gap-3">
            {viewModel.evaluations.map((evaluation) => (
              <EngineeringRuleCard
                key={evaluation.engineeringRuleId}
                evaluation={evaluation}
              />
            ))}
          </div>
        ) : null}

        {state === "locked" ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            {resolveMessage(
              appLocale,
              "pages.classification.states.lockedNextSteps",
            )}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          {actionVisibility.showFinalReport ? (
            <Button
              nativeButton={false}
              render={<Link href={`/assessments/${assessmentId}/documents`} />}
            >
              {resolveMessage(
                appLocale,
                "pages.classification.generateFinalReport",
              )}
            </Button>
          ) : null}
          {actionVisibility.showGapAnalysis ? (
            <Button
              nativeButton={false}
              render={<Link href={`/assessments/${assessmentId}/documents`} />}
              variant="outline"
            >
              {resolveMessage(
                appLocale,
                "pages.classification.generateGapAnalysis",
              )}
            </Button>
          ) : null}
        </div>
      </StatusCard>
    </PageShell>
  );
}

function EngineeringRuleCard({
  evaluation,
}: {
  evaluation: EngineeringRuleEvaluationViewModel;
}) {
  const legalReferences = Array.from(
    new Set([...evaluation.sourceLocators, ...evaluation.sourceChunkIds]),
  );
  const evidenceReferences = Array.from(new Set(evaluation.evidenceRefs));

  return (
    <article className="rounded-lg border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold">
            {formatEngineeringConcept(evaluation.concept)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{evaluation.concept}</p>
        </div>
        <span className={statusBadgeClassName(evaluation.status)}>
          {statusLabel(evaluation.status)}
        </span>
      </div>

      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        {evaluation.reason}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <DetailMetric
          label={resolveClassificationRuntimeMessage(appLocale, "confidence")}
          value={`${Math.round(evaluation.confidence * 100)}%`}
        />
        <DetailMetric
          label={resolveClassificationRuntimeMessage(appLocale, "technicalEvidence")}
          value={String(evidenceReferences.length)}
        />
        <DetailMetric
          label={resolveClassificationRuntimeMessage(appLocale, "limitations")}
          value={String(evaluation.limitations.length)}
        />
      </div>

      {evaluation.limitations.length ? (
        <div className="mt-4 rounded-md border bg-muted/20 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {resolveClassificationRuntimeMessage(appLocale, "limitations")}
          </p>
          <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
            {evaluation.limitations.map((limitation) => (
              <li key={`${evaluation.engineeringRuleId}:${limitation}`}>
                <span className="font-medium text-foreground/80">
                  {formatEngineeringLimitation(appLocale, limitation)}
                </span>
                <span className="ml-2 font-mono text-[11px]">{limitation}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {legalReferences.length ? (
        <div className="mt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {resolveMessage(appLocale, "pages.classification.referencesLabel")}
          </p>
          <ul className="mt-2 grid gap-1.5 text-sm text-muted-foreground sm:grid-cols-2">
            {legalReferences.map((reference) => (
              <li
                key={`${evaluation.engineeringRuleId}:legal:${reference}`}
                className="rounded-md border bg-muted/10 px-3 py-2"
                title={reference}
              >
                {formatLegalReference(appLocale, reference)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {resolveClassificationRuntimeMessage(appLocale, "technicalEvidence")}
        </p>
        {evidenceReferences.length ? (
          <ul className="mt-2 grid gap-1.5 text-xs text-muted-foreground">
            {evidenceReferences.slice(0, 12).map((reference) => (
              <li
                key={`${evaluation.engineeringRuleId}:evidence:${reference}`}
                className="break-all rounded-md border bg-muted/10 px-3 py-2 font-mono"
              >
                {reference}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            {resolveClassificationRuntimeMessage(
              appLocale,
              "noTechnicalEvidence",
            )}
          </p>
        )}
      </div>

      <details className="mt-4 rounded-md border bg-muted/10 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
          {resolveClassificationRuntimeMessage(appLocale, "technicalDetails")}
        </summary>
        <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
          <div>
            <dt className="font-medium text-muted-foreground">
              {resolveClassificationRuntimeMessage(appLocale, "engineeringRule")}
            </dt>
            <dd className="mt-1 break-all font-mono text-foreground/80">
              {evaluation.engineeringRuleId}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-muted-foreground">
              {resolveClassificationRuntimeMessage(appLocale, "legalRule")}
            </dt>
            <dd className="mt-1 break-all font-mono text-foreground/80">
              {evaluation.legalRuleId}
            </dd>
          </div>
        </dl>
      </details>
    </article>
  );
}

function PageShell({
  description,
  children,
}: {
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 lg:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          {resolveMessage(appLocale, "pages.classification.pageTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </header>
      {children}
    </div>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs font-medium text-muted-foreground">{label}</p>
    </div>
  );
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/10 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function directRuntimeDescription(state: string): string {
  if (state === "passed") {
    return resolveClassificationRuntimeMessage(appLocale, "passedDescription");
  }
  if (state === "blocked") {
    return resolveClassificationRuntimeMessage(appLocale, "blockedDescription");
  }
  if (state === "degraded") {
    return resolveClassificationRuntimeMessage(appLocale, "degradedDescription");
  }
  return resolveMessage(appLocale, "pages.classification.states.processingDescription");
}

function statusLabel(
  status: EngineeringRuleEvaluationViewModel["status"],
): string {
  if (status === "COMPLIANT") {
    return resolveClassificationRuntimeMessage(appLocale, "metricCompliant");
  }
  if (status === "NON_COMPLIANT") {
    return resolveClassificationRuntimeMessage(appLocale, "metricNonCompliant");
  }
  return resolveClassificationRuntimeMessage(appLocale, "metricUnknown");
}

function statusBadgeClassName(
  status: EngineeringRuleEvaluationViewModel["status"],
): string {
  const base = "rounded-full border px-2.5 py-1 text-xs font-semibold";
  if (status === "COMPLIANT") return `${base} bg-muted/30`;
  if (status === "NON_COMPLIANT") return `${base} bg-destructive/10`;
  return `${base} bg-muted/20`;
}
