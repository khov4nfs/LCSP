import * as React from "react";
import { resolveMessage } from "@lcsp/i18n";
import { ArrowRightIcon, WaypointsIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  ARTIFACT_OPEN_KINDS,
  buildArtifactOpenTarget,
} from "@/features/artifacts/utils/artifact-routes";
import {
  ARTIFACT_TYPES,
  type ArtifactRef,
} from "@/features/artifacts/types/artifact.types";
import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

import type {
  ProgramEvidenceMetric,
  ProgramEvidenceSummary as ProgramEvidenceSummaryData,
} from "../../types/structured-results.types";
import { ChatResultContainer } from "./chat-result-container";

export type ProgramEvidenceSummaryProps = {
  commitSha: string;
  summary: ProgramEvidenceSummaryData;
  assessmentId?: string;
  referenceUrl?: string;
  artifactRef?: ArtifactRef | null;
  onOpenArtifact?: (ref: ArtifactRef) => void;
  className?: string;
};

export function ProgramEvidenceSummary({
  commitSha,
  summary,
  assessmentId,
  referenceUrl,
  artifactRef,
  onOpenArtifact,
  className,
}: ProgramEvidenceSummaryProps) {
  const shortSha = commitSha ? commitSha.slice(0, 7) : "";

  const resolvedArtifactRef: ArtifactRef | null =
    artifactRef ??
    (assessmentId
      ? {
          assessmentId,
          type: ARTIFACT_TYPES.programEvidenceGraph,
        }
      : null);

  const target = resolvedArtifactRef
    ? buildArtifactOpenTarget(resolvedArtifactRef)
    : null;

  const canOpenArtifact =
    Boolean(onOpenArtifact && resolvedArtifactRef) ||
    (target !== null &&
      (target.kind === ARTIFACT_OPEN_KINDS.internal ||
        target.kind === ARTIFACT_OPEN_KINDS.download)) ||
    Boolean(referenceUrl);

  const href =
    target &&
    (target.kind === ARTIFACT_OPEN_KINDS.internal ||
      target.kind === ARTIFACT_OPEN_KINDS.download)
      ? target.href
      : referenceUrl;

  return (
    <ChatResultContainer
      className={cn("p-4", className)}
      header={
        <header className="flex min-w-0 items-start justify-between gap-3">
          <div className="flex min-w-0 gap-3">
            <span
              aria-hidden="true"
              className="mt-0.5 flex size-8.5 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/60 text-foreground"
            >
              <WaypointsIcon className="size-4" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold leading-5 text-foreground">
                {t("pages.assessmentFlow.graph.title")}
              </h3>
              <p className="mt-0.5 truncate text-xs leading-5 text-muted-foreground">
                {t("pages.assessmentFlow.graph.subtitle")} {shortSha}
              </p>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center rounded-full border border-emerald-800/40 bg-emerald-950/60 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
            {t("pages.assessmentFlow.graph.ready")}
          </span>
        </header>
      }
      footer={
        <footer className="flex min-w-0 items-center justify-between gap-3">
          {href && !onOpenArtifact ? (
            <Link
              href={href}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              aria-label={t("pages.assessmentFlow.graph.viewEvidenceGraph")}
            >
              {t("pages.assessmentFlow.graph.viewEvidenceGraph")}
              <ArrowRightIcon aria-hidden="true" className="size-3.5" />
            </Link>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!canOpenArtifact}
              onClick={() => {
                if (onOpenArtifact && resolvedArtifactRef) {
                  onOpenArtifact(resolvedArtifactRef);
                }
              }}
              className="h-7 min-w-0 px-0 text-xs font-medium text-primary hover:bg-transparent hover:underline disabled:text-muted-foreground disabled:no-underline"
            >
              {t("pages.assessmentFlow.graph.viewEvidenceGraph")}
              <ArrowRightIcon aria-hidden="true" className="size-3.5" />
            </Button>
          )}
          <p className="shrink-0 text-xs text-muted-foreground">
            {t("pages.assessmentFlow.graph.artifactMetadata")}
          </p>
        </footer>
      }
    >
      <div className="border-t border-border/60 pt-3">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
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
    </ChatResultContainer>
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
        <span className="shrink-0 text-lg font-semibold leading-6 text-foreground">
          {formatMetric(metric)}
        </span>
        <span className="min-w-0 truncate text-xs font-medium leading-5 text-foreground">
          {label}
        </span>
      </dt>
      <dd className="mt-0.5 text-xs leading-4.5 text-muted-foreground">
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
