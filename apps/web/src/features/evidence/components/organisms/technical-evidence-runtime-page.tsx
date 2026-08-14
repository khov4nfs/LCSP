"use client";

import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";
import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";
import {
  ASSESSMENT_RUNTIME_EVENT_TYPES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  ASSESSMENT_RUNTIME_STAGE_CODES,
} from "@lcsp/contracts/evidence";
import { resolveMessage } from "@lcsp/i18n";
import { ActivityIcon, ClockIcon, RotateCcwIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { appLocale } from "@/lib/locale";
import { useRerunRepositoryScanMutation } from "@/lib/api/assessment-queries";
import { useWorkspaceRuntime } from "@/features/workspace/components/organisms/workspace-runtime-provider";
import {
  WORKSPACE_RUNTIME_CONNECTION_STATES,
  type WorkspaceRuntimeActivityItem,
  type WorkspaceRuntimeActiveTool,
  type WorkspaceRuntimeConnectionState,
  type WorkspaceRuntimeRun,
  type WorkspaceRuntimeSummaryValue,
} from "@/features/workspace/types/workspace-runtime.types";

export function TechnicalEvidenceRuntimePage({
  assessmentId,
}: {
  assessmentId: string;
}) {
  const runtime = useWorkspaceRuntime();
  const scanJobs = runtime.scanJobs.filter(
    (scanJob) => scanJob.assessmentId === assessmentId,
  );
  const reports = runtime.evidenceReports.filter(
    (report) => report.assessmentId === assessmentId,
  );
  const timeline = runtime.getAssessmentRuntime(assessmentId);
  const latestScan = scanJobs[0];
  const rerunMutation = useRerunRepositoryScanMutation(assessmentId);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 lg:px-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            {t("pages.technicalEvidence.pageTitle")}
          </h1>
          <Badge variant={connectionBadgeVariant(runtime.connectionState)}>
            {connectionLabel(runtime.connectionState)}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("pages.technicalEvidence.pageDescription")}
        </p>
      </header>

      <section className="overflow-hidden rounded-lg border">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <ActivityIcon className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">
              {t("pages.technicalEvidence.orchestrationTitle")}
            </h2>
          </div>
          <span className="text-xs text-muted-foreground">
            {timeline.lastEmittedAt === null
              ? t("pages.technicalEvidence.awaitingEvent")
              : `${t("pages.technicalEvidence.lastUpdated")}: ${formatDate(timeline.lastEmittedAt)}`}
          </span>
        </div>

        {timeline.currentRun !== null ? (
          <CurrentRunPanel run={timeline.currentRun} />
        ) : null}

        {timeline.recentActivity.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            {t("pages.technicalEvidence.noOrchestrationActivity")}
          </p>
        ) : (
          <ul className="divide-y">
            {timeline.recentActivity.map((item) => (
              <RuntimeActivityItem key={item.eventId} item={item} />
            ))}
          </ul>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
          <h2 className="text-sm font-medium">
            {t("pages.technicalEvidence.scanJobsTitle")}
          </h2>
          <span className="text-xs text-muted-foreground">
            {runtime.emittedAt === null
              ? t("pages.technicalEvidence.awaitingEvent")
              : `${t("pages.technicalEvidence.lastUpdated")}: ${formatDate(runtime.emittedAt)}`}
          </span>
          <Button
            disabled={latestScan === undefined || rerunMutation.isPending}
            onClick={() => {
              if (latestScan !== undefined) {
                rerunMutation.mutate({ snapshotId: latestScan.snapshotId });
              }
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            <RotateCcwIcon />
            {rerunMutation.isPending
              ? t("pages.technicalEvidence.rerunningScan")
              : t("pages.technicalEvidence.rerunScan")}
          </Button>
        </div>
        {rerunMutation.isError && (
          <p className="border-b px-4 py-3 text-sm text-destructive">
            {t("pages.technicalEvidence.rerunError")}
          </p>
        )}
        {scanJobs.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            {t("pages.technicalEvidence.noScanJobs")}
          </p>
        ) : (
          <ul className="divide-y">
            {scanJobs.map((scanJob) => (
              <li
                className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                key={scanJob.id}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {t("pages.technicalEvidence.scanJobLabel")} {scanJob.id}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("pages.technicalEvidence.updatedAt")}:{" "}
                    {formatDate(scanJob.updatedAt)}
                  </p>
                  {scanJob.blockedReason !== null && (
                    <p className="mt-1 text-xs text-destructive">
                      {scanJob.blockedReason}
                    </p>
                  )}
                </div>
                <Badge variant={scanBadgeVariant(scanJob.status)}>
                  {scanStatusLabel(scanJob.status)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border">
        <div className="border-b bg-muted/30 px-4 py-3">
          <h2 className="text-sm font-medium">
            {t("pages.technicalEvidence.evidenceReportsTitle")}
          </h2>
        </div>
        {reports.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            {t("pages.technicalEvidence.noEvidenceReports")}
          </p>
        ) : (
          <ul className="divide-y">
            {reports.map((report) => (
              <li
                className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                key={report.id}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {t("pages.technicalEvidence.evidenceReportLabel")}{" "}
                    {report.id}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("pages.technicalEvidence.createdAt")}:{" "}
                    {formatDate(report.createdAt)}
                  </p>
                  {report.rejectionReason !== null && (
                    <p className="mt-1 text-xs text-destructive">
                      {report.rejectionReason}
                    </p>
                  )}
                </div>
                <Badge
                  variant={
                    report.status ===
                    TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted
                      ? "default"
                      : "destructive"
                  }
                >
                  {reportStatusLabel(report.status)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CurrentRunPanel({ run }: { run: WorkspaceRuntimeRun }) {
  return (
    <div className="border-b px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={runtimeStatusBadgeVariant(run.status)}>
          {runtimeStatusLabel(run.status)}
        </Badge>
        <span className="text-sm font-medium">{runtimeStageLabel(run.stage)}</span>
        <span className="text-xs text-muted-foreground">
          {t("pages.technicalEvidence.updatedAt")}: {formatDate(run.updatedAt)}
        </span>
      </div>

      {run.activeTools.length > 0 ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {run.activeTools.map((tool) => (
            <ActiveToolItem
              key={`${run.runId}-${tool.toolName}`}
              tool={tool}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ActiveToolItem({ tool }: { tool: WorkspaceRuntimeActiveTool }) {
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-medium">{tool.toolName}</p>
        <Badge variant={runtimeStatusBadgeVariant(tool.status)}>
          {runtimeStatusLabel(tool.status)}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{tool.summary}</p>
      {tool.startedAt !== null || tool.attempt !== null ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {tool.startedAt !== null ? formatDate(tool.startedAt) : null}
          {tool.startedAt !== null && tool.attempt !== null ? " / " : null}
          {tool.attempt !== null
            ? `${t("pages.technicalEvidence.attemptLabel")} ${tool.attempt}`
            : null}
        </p>
      ) : null}
    </div>
  );
}

function RuntimeActivityItem({ item }: { item: WorkspaceRuntimeActivityItem }) {
  return (
    <li className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-start">
      <div className="flex items-center gap-2 text-xs text-muted-foreground md:w-40 md:shrink-0">
        <ClockIcon className="size-3.5" />
        <span>{formatDate(item.emittedAt)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">
            {item.toolName ?? runtimeEventLabel(item.eventType)}
          </p>
          <span className="text-xs text-muted-foreground">
            {runtimeStageLabel(item.stage)}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{item.summary}</p>
        <RuntimeDetailList item={item} />
      </div>
      <div className="md:shrink-0">
        <Badge variant={runtimeStatusBadgeVariant(item.runStatus)}>
          {runtimeStatusLabel(item.runStatus)}
        </Badge>
      </div>
    </li>
  );
}

function RuntimeDetailList({ item }: { item: WorkspaceRuntimeActivityItem }) {
  const details = [
    item.inputSummary === null
      ? null
      : {
          label: t("pages.technicalEvidence.inputSummaryLabel"),
          value: formatSummaryValue(item.inputSummary),
        },
    item.outputSummary === null
      ? null
      : {
          label: t("pages.technicalEvidence.outputSummaryLabel"),
          value: formatSummaryValue(item.outputSummary),
        },
    item.errorSummary === null
      ? null
      : {
          label: t("pages.technicalEvidence.errorSummaryLabel"),
          value: item.errorSummary,
        },
    item.waitingReason === null
      ? null
      : {
          label: t("pages.technicalEvidence.waitingReasonLabel"),
          value: item.waitingReason,
        },
  ].filter(isDefined);

  if (details.length === 0) {
    return null;
  }

  return (
    <dl className="mt-2 grid gap-2 text-xs">
      {details.map((detail) => (
        <div className="grid gap-1" key={detail.label}>
          <dt className="font-medium text-foreground">{detail.label}</dt>
          <dd className="rounded-md bg-muted/40 px-2 py-1.5 font-mono text-muted-foreground">
            {detail.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function connectionBadgeVariant(state: WorkspaceRuntimeConnectionState) {
  return state === WORKSPACE_RUNTIME_CONNECTION_STATES.connected
    ? "default"
    : "secondary";
}

function connectionLabel(state: WorkspaceRuntimeConnectionState) {
  if (state === WORKSPACE_RUNTIME_CONNECTION_STATES.connected) {
    return t("pages.technicalEvidence.connectionConnected");
  }
  if (state === WORKSPACE_RUNTIME_CONNECTION_STATES.disconnected) {
    return t("pages.technicalEvidence.connectionDisconnected");
  }
  return t("pages.technicalEvidence.connectionConnecting");
}

function scanBadgeVariant(status: string) {
  return status === REPOSITORY_SCAN_JOB_STATUSES.completed
    ? "default"
    : "secondary";
}

function scanStatusLabel(status: string) {
  const statuses = REPOSITORY_SCAN_JOB_STATUSES;
  if (status === statuses.queued)
    return t("pages.technicalEvidence.scanStatuses.queued");
  if (status === statuses.running)
    return t("pages.technicalEvidence.scanStatuses.running");
  if (status === statuses.completed)
    return t("pages.technicalEvidence.scanStatuses.completed");
  if (status === statuses.failed)
    return t("pages.technicalEvidence.scanStatuses.failed");
  if (status === statuses.blocked)
    return t("pages.technicalEvidence.scanStatuses.blocked");
  return t("pages.technicalEvidence.scanStatuses.pending");
}

function reportStatusLabel(status: string) {
  return status === TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted
    ? t("pages.technicalEvidence.evidenceStatuses.accepted")
    : t("pages.technicalEvidence.evidenceStatuses.rejected");
}

function runtimeStatusBadgeVariant(status: string) {
  if (status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed) return "destructive";
  if (status === ASSESSMENT_RUNTIME_RUN_STATUSES.completed) return "default";
  return "secondary";
}

function runtimeStatusLabel(status: string) {
  const statuses = ASSESSMENT_RUNTIME_RUN_STATUSES;
  if (status === statuses.running)
    return t("pages.technicalEvidence.runtimeStatuses.running");
  if (status === statuses.waiting)
    return t("pages.technicalEvidence.runtimeStatuses.waiting");
  if (status === statuses.completed)
    return t("pages.technicalEvidence.runtimeStatuses.completed");
  if (status === statuses.failed)
    return t("pages.technicalEvidence.runtimeStatuses.failed");
  return status;
}

function runtimeStageLabel(stage: string) {
  const stages = ASSESSMENT_RUNTIME_STAGE_CODES;
  if (stage === stages.snapshot)
    return t("pages.technicalEvidence.runtimeStages.snapshot");
  if (stage === stages.scan) return t("pages.technicalEvidence.runtimeStages.scan");
  if (stage === stages.technicalEvidence)
    return t("pages.technicalEvidence.runtimeStages.technicalEvidence");
  if (stage === stages.technicalProfile)
    return t("pages.technicalEvidence.runtimeStages.technicalProfile");
  if (stage === stages.aiUsageFlow)
    return t("pages.technicalEvidence.runtimeStages.aiUsageFlow");
  if (stage === stages.reconciliation)
    return t("pages.technicalEvidence.runtimeStages.reconciliation");
  if (stage === stages.classification)
    return t("pages.technicalEvidence.runtimeStages.classification");
  if (stage === stages.conflicts)
    return t("pages.technicalEvidence.runtimeStages.conflicts");
  if (stage === stages.documents)
    return t("pages.technicalEvidence.runtimeStages.documents");
  if (stage === stages.legalRetrieval)
    return t("pages.technicalEvidence.runtimeStages.legalRetrieval");
  return stage;
}

function runtimeEventLabel(eventType: string) {
  const events = ASSESSMENT_RUNTIME_EVENT_TYPES;
  if (eventType === events.runStarted)
    return t("pages.technicalEvidence.runtimeEvents.runStarted");
  if (eventType === events.runStageChanged)
    return t("pages.technicalEvidence.runtimeEvents.runStageChanged");
  if (eventType === events.toolStarted)
    return t("pages.technicalEvidence.runtimeEvents.toolStarted");
  if (eventType === events.toolCompleted)
    return t("pages.technicalEvidence.runtimeEvents.toolCompleted");
  if (eventType === events.toolFailed)
    return t("pages.technicalEvidence.runtimeEvents.toolFailed");
  if (eventType === events.toolWaitingInput)
    return t("pages.technicalEvidence.runtimeEvents.toolWaitingInput");
  if (eventType === events.toolSkipped)
    return t("pages.technicalEvidence.runtimeEvents.toolSkipped");
  if (eventType === events.runCompleted)
    return t("pages.technicalEvidence.runtimeEvents.runCompleted");
  if (eventType === events.runFailed)
    return t("pages.technicalEvidence.runtimeEvents.runFailed");
  return eventType;
}

function formatSummaryValue(value: WorkspaceRuntimeSummaryValue) {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function isDefined<T>(value: T | null): value is T {
  return value !== null;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(appLocale, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
