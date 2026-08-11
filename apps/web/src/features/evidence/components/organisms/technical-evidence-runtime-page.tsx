"use client";

import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";
import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";
import { resolveMessage } from "@lcsp/i18n";
import { RotateCcwIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { appLocale } from "@/lib/locale";
import { useRerunRepositoryScanMutation } from "@/lib/api/assessment-queries";
import { useWorkspaceRuntime } from "@/features/workspace/components/organisms/workspace-runtime-provider";
import {
  WORKSPACE_RUNTIME_CONNECTION_STATES,
  type WorkspaceRuntimeConnectionState,
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat(appLocale, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
