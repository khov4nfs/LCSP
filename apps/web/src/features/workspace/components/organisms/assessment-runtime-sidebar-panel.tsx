"use client";

import { resolveMessage } from "@lcsp/i18n";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { appLocale } from "@/lib/locale";
import { ASSESSMENT_RUNTIME_RUN_STATUSES } from "@lcsp/contracts/evidence";
import {
  WORKSPACE_RUNTIME_CONNECTION_STATES,
  type WorkspaceRuntimeAssessmentTimeline,
  type WorkspaceRuntimeConnectionState,
} from "../../types/workspace-runtime.types";
import {
  connectionLabel,
  runStatusLabel,
  stageLabel,
  formatTimelineTime,
} from "../../utils/assessment-runtime-formatter.ts";

export function AssessmentRuntimeSidebarPanel({
  assessmentId,
  timeline,
}: {
  assessmentId: string;
  timeline: WorkspaceRuntimeAssessmentTimeline;
}) {
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsHydrated(true);
  }, []);

  const effectiveTimeline = isHydrated
    ? timeline
    : {
        currentRun: null,
        recentActivity: [],
        latestRunId: null,
        connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connecting,
        lastEmittedAt: null,
      };

  const activeRun = isActiveRuntimeStatus(effectiveTimeline.currentRun?.status)
    ? effectiveTimeline.currentRun
    : null;
  const activeActivity =
    effectiveTimeline.recentActivity.find((item) =>
      isActiveRuntimeStatus(item.runStatus),
    ) ?? null;

  if (activeRun === null && activeActivity === null) {
    return null;
  }

  const activeStage = activeRun?.stage ?? activeActivity?.stage ?? null;
  const activeStatus = activeRun?.status ?? activeActivity?.runStatus ?? null;
  const activeSummary =
    activeActivity?.summary ??
    (activeStage === null ? null : stageLabel(activeStage));
  const activeUpdatedAt =
    activeActivity?.emittedAt ??
    activeRun?.updatedAt ??
    effectiveTimeline.lastEmittedAt;

  return (
    <div className="mt-3 rounded-lg border border-sidebar-border/70 bg-sidebar-accent/20 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {t("pages.appShell.runtimePanelTitle")}
          </p>
          <p className="mt-1 text-xs text-sidebar-foreground/65">
            {activeUpdatedAt === null
              ? t("pages.appShell.runtimePanelAwaiting")
              : `${t("pages.appShell.runtimePanelLastUpdated")}: ${formatTimelineTime(
                  activeUpdatedAt,
                  isHydrated,
                )}`}
          </p>
        </div>
        <Badge variant={connectionBadgeVariant(effectiveTimeline.connectionState)}>
          {connectionLabel(effectiveTimeline.connectionState)}
        </Badge>
      </div>

      <div className="mt-3 space-y-2">
        {activeStage !== null && activeStatus !== null ? (
          <div className="flex items-center gap-2">
            <Badge variant={statusBadgeVariant(activeStatus)}>
              {runStatusLabel(activeStatus)}
            </Badge>
            <span className="truncate text-xs text-sidebar-foreground/80">
              {stageLabel(activeStage)}
            </span>
          </div>
        ) : null}
        {activeSummary !== null ? (
          <p className="text-xs text-sidebar-foreground/70">{activeSummary}</p>
        ) : null}
      </div>

      <div className="mt-3">
        <Link
          className="text-xs font-medium text-sidebar-primary underline-offset-4 hover:underline"
          href={`/assessments/${assessmentId}/technical-evidence`}
        >
          {t("pages.appShell.runtimePanelViewFull")}
        </Link>
      </div>
    </div>
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}

function connectionBadgeVariant(state: WorkspaceRuntimeConnectionState) {
  return state === WORKSPACE_RUNTIME_CONNECTION_STATES.connected
    ? "default"
    : "secondary";
}

function statusBadgeVariant(status: string) {
  if (status === ASSESSMENT_RUNTIME_RUN_STATUSES.failed) return "destructive";
  if (status === ASSESSMENT_RUNTIME_RUN_STATUSES.completed) return "default";
  return "secondary";
}

function isActiveRuntimeStatus(status: string | null | undefined): boolean {
  return (
    status === ASSESSMENT_RUNTIME_RUN_STATUSES.running ||
    status === ASSESSMENT_RUNTIME_RUN_STATUSES.waiting
  );
}
