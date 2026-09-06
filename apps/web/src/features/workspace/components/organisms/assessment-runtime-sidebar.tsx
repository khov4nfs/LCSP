"use client";

import { ChevronRightIcon } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { resolveMessage } from "@lcsp/i18n";
import { appLocale } from "@/lib/locale";

import {
  ASSESSMENT_SIDEBAR_STATUSES,
  type AssessmentSidebarStatus,
  type NormalizedAssessmentSidebarArtifactItem,
  type NormalizedAssessmentSidebarPresentation,
  type NormalizedAssessmentSidebarWorkflowItem,
} from "../../types/assessment-runtime-adapter.types";

export function AssessmentRuntimeSidebar({
  presentation,
}: {
  presentation: NormalizedAssessmentSidebarPresentation;
}) {
  return (
    <div
      className="flex min-h-0 w-full flex-col bg-background"
      data-component="AssessmentRuntimeSidebar"
    >
      <header className="flex h-13 shrink-0 items-center border-b border-border/70 px-4.5">
        <h2 className="text-[15px] font-semibold text-foreground">
          {t("pages.appShell.assessmentSidebar.title")}
        </h2>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4.5 py-4">
        <SidebarSection
          title={t("pages.appShell.assessmentSidebar.repositoryContext")}
        >
          <RepositoryContextCard repository={presentation.repository} />
        </SidebarSection>

        <SidebarSection
          className="mt-4"
          title={t("pages.appShell.assessmentSidebar.workflowTitle")}
        >
          <WorkflowStatusList items={presentation.workflow} />
        </SidebarSection>

        <SidebarSection
          className="mt-4"
          title={t("pages.appShell.assessmentSidebar.artifactsAndEvidence")}
          trailing={t(presentation.artifactSummaryKey)}
        >
          <ArtifactEvidenceRail items={presentation.artifacts} />
        </SidebarSection>
      </div>
    </div>
  );
}

function SidebarSection({
  children,
  className,
  title,
  trailing,
}: {
  children: ReactNode;
  className?: string;
  title: string;
  trailing?: string;
}) {
  return (
    <section className={className}>
      <div className="mb-2.5 flex min-h-4.5 items-center justify-between gap-3">
        <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>
        {trailing ? (
          <p className="shrink-0 text-[11px] text-muted-foreground">
            {trailing}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function RepositoryContextCard({
  repository,
}: {
  repository: NormalizedAssessmentSidebarPresentation["repository"];
}) {
  if (!repository) {
    return (
      <div className="flex h-23 w-full flex-col justify-center rounded-[10px] border border-dashed border-border px-3.5">
        <p className="text-xs text-muted-foreground">
          {t("pages.appShell.assessmentSidebar.repositoryUnavailable")}
        </p>
      </div>
    );
  }

  const shortCommit = repository.commitSha.slice(0, 7);

  return (
    <div className="flex h-23 w-full flex-col justify-center rounded-[10px] border border-border/80 bg-card px-3.5">
      {repository.repositoryFullName ? (
        <p className="truncate text-[13px] font-medium text-foreground">
          {repository.repositoryFullName}
        </p>
      ) : null}
      {repository.branch ? (
        <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
          {repository.branch}
        </p>
      ) : null}
      <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
        {t("pages.appShell.assessmentSidebar.pinnedCommit").replace(
          "{commit}",
          shortCommit,
        )}
      </p>
    </div>
  );
}

function WorkflowStatusList({
  items,
}: {
  items: NormalizedAssessmentSidebarWorkflowItem[];
}) {
  return (
    <ol className="h-55 rounded-[10px] border border-border/80 bg-card px-3.5 py-2">
      {items.map((item, index) => (
        <WorkflowStatusRow
          item={item}
          isLast={index === items.length - 1}
          key={item.id}
        />
      ))}
    </ol>
  );
}

function WorkflowStatusRow({
  isLast,
  item,
}: {
  isLast: boolean;
  item: NormalizedAssessmentSidebarWorkflowItem;
}) {
  const active =
    item.status === ASSESSMENT_SIDEBAR_STATUSES.running ||
    item.status === ASSESSMENT_SIDEBAR_STATUSES.passed;

  return (
    <li className="relative flex h-8.5 items-start gap-3">
      {!isLast ? (
        <span
          aria-hidden="true"
          className="absolute left-1 top-3.5 h-6 w-px bg-border"
        />
      ) : null}
      <RuntimeStatusDot className="mt-1.5" status={item.status} />
      <p
        className={cn(
          "min-w-0 flex-1 truncate text-xs text-foreground",
          active && "font-medium",
        )}
      >
        {t(item.labelKey)}
      </p>
      <RuntimeStatusBadge status={item.status} />
    </li>
  );
}

function ArtifactEvidenceRail({
  items,
}: {
  items: NormalizedAssessmentSidebarArtifactItem[];
}) {
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <ArtifactEvidenceRow item={item} key={item.id} />
      ))}
    </div>
  );
}

function ArtifactEvidenceRow({
  item,
}: {
  item: NormalizedAssessmentSidebarArtifactItem;
}) {
  return (
    <div
      className="grid h-15 w-full grid-cols-[28px_minmax(0,1fr)_94px_14px] items-start gap-2.5 rounded-[10px] border border-border/80 bg-background px-3 py-2"
      data-artifact-id={item.artifact.id}
      data-artifact-kind={item.artifact.kind}
    >
      <Image
        alt=""
        aria-hidden="true"
        className="mt-1.5 size-7"
        height={28}
        src="/assets/figma/assessment/output-icon.svg"
        width={28}
      />
      <div className="min-w-0">
        <p className="min-w-0 truncate text-xs font-medium text-foreground">
          {t(item.labelKey)}
        </p>
        <p className="mt-1 truncate text-[10.5px] text-muted-foreground">
          {formatMessage(item.descriptionKey, item.descriptionParams)}
        </p>
      </div>
      <div className="flex min-w-0 items-center justify-end gap-2 pt-0.5">
        <RuntimeStatusDot status={item.status} />
        <RuntimeStatusBadge status={item.status} compact />
      </div>
      <ChevronRightIcon
        aria-hidden="true"
        className="mt-7 size-3.5 shrink-0 text-muted-foreground"
      />
    </div>
  );
}

function RuntimeStatusBadge({
  compact = false,
  status,
}: {
  compact?: boolean;
  status: AssessmentSidebarStatus;
}) {
  return (
    <span
      className={cn(
        "shrink-0 whitespace-nowrap text-right text-[11px]",
        compact ? "w-20" : "w-24",
        statusTextClassName(status),
      )}
    >
      {statusLabel(status)}
    </span>
  );
}

function RuntimeStatusDot({
  className,
  status,
}: {
  className?: string;
  status: AssessmentSidebarStatus;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-2 shrink-0 rounded-full",
        statusDotClassName(status),
        className,
      )}
    />
  );
}

function statusLabel(status: AssessmentSidebarStatus) {
  if (status === ASSESSMENT_SIDEBAR_STATUSES.running) {
    return t("pages.appShell.assessmentSidebar.statuses.running");
  }
  if (status === ASSESSMENT_SIDEBAR_STATUSES.queued) {
    return t("pages.appShell.assessmentSidebar.statuses.queued");
  }
  if (status === ASSESSMENT_SIDEBAR_STATUSES.passed) {
    return t("pages.appShell.assessmentSidebar.statuses.passed");
  }
  if (status === ASSESSMENT_SIDEBAR_STATUSES.building) {
    return t("pages.appShell.assessmentSidebar.statuses.building");
  }
  if (status === ASSESSMENT_SIDEBAR_STATUSES.ready) {
    return t("pages.appShell.assessmentSidebar.statuses.ready");
  }
  if (status === ASSESSMENT_SIDEBAR_STATUSES.failed) {
    return t("pages.appShell.assessmentSidebar.statuses.failed");
  }
  return t("pages.appShell.assessmentSidebar.statuses.waiting");
}

function statusTextClassName(status: AssessmentSidebarStatus) {
  if (status === ASSESSMENT_SIDEBAR_STATUSES.running) {
    return "text-blue-500";
  }
  if (
    status === ASSESSMENT_SIDEBAR_STATUSES.passed ||
    status === ASSESSMENT_SIDEBAR_STATUSES.ready
  ) {
    return "text-green-500";
  }
  if (
    status === ASSESSMENT_SIDEBAR_STATUSES.building ||
    status === ASSESSMENT_SIDEBAR_STATUSES.failed
  ) {
    return status === ASSESSMENT_SIDEBAR_STATUSES.failed
      ? "text-destructive"
      : "text-blue-500";
  }
  return "text-muted-foreground";
}

function statusDotClassName(status: AssessmentSidebarStatus) {
  if (status === ASSESSMENT_SIDEBAR_STATUSES.running) {
    return "bg-blue-500";
  }
  if (
    status === ASSESSMENT_SIDEBAR_STATUSES.passed ||
    status === ASSESSMENT_SIDEBAR_STATUSES.ready
  ) {
    return "bg-green-500";
  }
  if (status === ASSESSMENT_SIDEBAR_STATUSES.building) {
    return "bg-blue-500";
  }
  if (status === ASSESSMENT_SIDEBAR_STATUSES.failed) {
    return "bg-destructive";
  }
  return "bg-muted-foreground";
}

function formatMessage(key: string, params?: Record<string, string>) {
  let message = t(key);
  for (const [name, value] of Object.entries(params ?? {})) {
    message = message.replace(`{${name}}`, value);
  }
  return message;
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
