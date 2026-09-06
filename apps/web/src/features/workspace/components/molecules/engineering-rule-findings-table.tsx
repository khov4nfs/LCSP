import * as React from "react";
import { resolveMessage } from "@lcsp/i18n";
import { ArrowRightIcon } from "lucide-react";
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

import {
  FINDING_PRIORITIES,
  type EngineeringRuleFindingViewModel,
  type FindingPriority,
} from "../../types/structured-results.types";
import { ChatResultContainer } from "./chat-result-container";

export type EngineeringRuleFindingsTableProps = {
  findings: EngineeringRuleFindingViewModel[];
  assessmentId?: string;
  artifactRef?: ArtifactRef | null;
  onOpenArtifact?: (ref: ArtifactRef) => void;
  className?: string;
};

export function EngineeringRuleFindingsTable({
  findings = [],
  assessmentId,
  artifactRef,
  onOpenArtifact,
  className,
}: EngineeringRuleFindingsTableProps) {
  const resolvedArtifactRef: ArtifactRef | null =
    artifactRef ??
    (assessmentId
      ? {
          assessmentId,
          type: ARTIFACT_TYPES.findingsReport,
        }
      : null);

  const target = resolvedArtifactRef
    ? buildArtifactOpenTarget(resolvedArtifactRef)
    : null;

  const canOpenArtifact =
    Boolean(onOpenArtifact && resolvedArtifactRef) ||
    (target !== null &&
      (target.kind === ARTIFACT_OPEN_KINDS.internal ||
        target.kind === ARTIFACT_OPEN_KINDS.download));

  const href =
    target &&
    (target.kind === ARTIFACT_OPEN_KINDS.internal ||
      target.kind === ARTIFACT_OPEN_KINDS.download)
      ? target.href
      : undefined;

  return (
    <ChatResultContainer
      className={cn("p-0 overflow-hidden", className)}
      footer={
        resolvedArtifactRef ? (
          <footer className="flex min-w-0 items-center justify-between gap-3 px-4 py-3">
            {href && !onOpenArtifact ? (
              <Link
                href={href}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                aria-label={t("pages.structuredResults.findingsTable.viewTechnicalDetails")}
              >
                {t("pages.structuredResults.findingsTable.viewTechnicalDetails")}
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
                {t("pages.structuredResults.findingsTable.viewTechnicalDetails")}
                <ArrowRightIcon aria-hidden="true" className="size-3.5" />
              </Button>
            )}
          </footer>
        ) : null
      }
    >
      {findings.length > 0 ? (
        <>
          {/* Desktop/Tablet Table Layout */}
          <div className="hidden sm:block overflow-x-auto">
            <table
              data-slot="findings-table"
              className="w-full table-fixed border-collapse text-left"
            >
              <thead>
                <tr className="border-b border-border/60 bg-muted/20 text-[10px] font-semibold text-muted-foreground">
                  <th scope="col" className="w-25 px-3.5 py-2">
                    {t("pages.structuredResults.findingsTable.priorityHeader")}
                  </th>
                  <th scope="col" className="w-48 px-3 py-2">
                    {t("pages.structuredResults.findingsTable.issueHeader")}
                  </th>
                  <th scope="col" className="w-58 px-3 py-2">
                    {t("pages.structuredResults.findingsTable.whyItMattersHeader")}
                  </th>
                  <th scope="col" className="w-32.5 px-3.5 py-2">
                    {t("pages.structuredResults.findingsTable.foundInHeader")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {findings.map((finding) => (
                  <tr
                    key={finding.id}
                    data-slot="finding-row"
                    className="align-top hover:bg-muted/10 transition-colors"
                  >
                    <td className="px-3.5 py-3">
                      <PriorityBadge priority={finding.priority} />
                    </td>
                    <td className="px-3 py-3 text-[11px] font-semibold leading-4 text-foreground break-words">
                      {finding.issue}
                    </td>
                    <td className="px-3 py-3 text-[11px] leading-4 text-muted-foreground break-words">
                      {finding.whyItMatters}
                    </td>
                    <td className="px-3.5 py-3 text-[10px] leading-3.5 text-muted-foreground">
                      <FoundInCell source={finding.source} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Narrow / Mobile Stacked Layout */}
          <div
            data-slot="findings-stacked"
            className="sm:hidden divide-y divide-border/40"
          >
            {findings.map((finding) => (
              <article key={finding.id} className="p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <PriorityBadge priority={finding.priority} />
                  {finding.source.ruleId ? (
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {finding.source.ruleId}
                    </span>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold leading-4 text-foreground">
                    {finding.issue}
                  </p>
                  <p className="text-[11px] leading-4 text-muted-foreground">
                    {finding.whyItMatters}
                  </p>
                </div>
                <div className="pt-1 text-[10px] text-muted-foreground">
                  <FoundInCell source={finding.source} />
                </div>
              </article>
            ))}
          </div>
        </>
      ) : (
        <div className="p-4 text-center text-xs text-muted-foreground">
          {t("pages.structuredResults.findingsTable.noFindings")}
        </div>
      )}
    </ChatResultContainer>
  );
}

function PriorityBadge({ priority }: { priority?: FindingPriority | null }) {
  if (priority === FINDING_PRIORITIES.high) {
    return (
      <span
        data-slot="priority-badge-high"
        className="inline-flex items-center justify-center rounded-full border border-red-800/40 bg-red-950/70 px-2.5 py-0.5 text-[10px] font-semibold text-red-200"
      >
        {t("pages.structuredResults.findingsTable.priorities.high")}
      </span>
    );
  }

  if (priority === FINDING_PRIORITIES.medium) {
    return (
      <span
        data-slot="priority-badge-medium"
        className="inline-flex items-center justify-center rounded-full border border-amber-800/40 bg-amber-950/70 px-2.5 py-0.5 text-[10px] font-semibold text-amber-200"
      >
        {t("pages.structuredResults.findingsTable.priorities.medium")}
      </span>
    );
  }

  if (priority === FINDING_PRIORITIES.low) {
    return (
      <span
        data-slot="priority-badge-low"
        className="inline-flex items-center justify-center rounded-full border border-border/60 bg-muted/60 px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground"
      >
        {t("pages.structuredResults.findingsTable.priorities.low")}
      </span>
    );
  }

  return (
    <span
      data-slot="priority-badge-unspecified"
      className="inline-flex items-center justify-center rounded-full border border-border/40 bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
    >
      {t("pages.structuredResults.findingsTable.priorities.unspecified")}
    </span>
  );
}

function FoundInCell({
  source,
}: {
  source: EngineeringRuleFindingViewModel["source"];
}) {
  const hasFile = Boolean(source.filePath);
  const hasLine = typeof source.startLine === "number" && source.startLine > 0;
  const hasRule = Boolean(source.ruleId);

  if (!hasFile && !hasLine && !hasRule) {
    return <span className="text-muted-foreground/60">—</span>;
  }

  const lineText = hasLine
    ? t("pages.structuredResults.findingsTable.lineInfo").replace(
        "{line}",
        String(source.startLine),
      )
    : null;

  const ruleText = source.ruleId;

  const secondaryMeta = [lineText, ruleText].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      {hasFile ? (
        <span className="font-mono break-all text-foreground/90">
          {source.filePath}
        </span>
      ) : null}
      {secondaryMeta ? (
        <span className="text-muted-foreground">{secondaryMeta}</span>
      ) : null}
    </div>
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
