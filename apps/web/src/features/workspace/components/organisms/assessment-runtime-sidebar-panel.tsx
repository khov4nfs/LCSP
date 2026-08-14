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
  runtimeEventLabel,
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

  const hasActivity =
    effectiveTimeline.currentRun !== null || effectiveTimeline.recentActivity.length > 0;

  return (
    <div className="mt-3 rounded-lg border border-sidebar-border/70 bg-sidebar-accent/20 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {t("pages.appShell.runtimePanelTitle")}
          </p>
          <p className="mt-1 text-xs text-sidebar-foreground/65">
            {effectiveTimeline.lastEmittedAt === null
              ? t("pages.appShell.runtimePanelAwaiting")
              : `${t("pages.appShell.runtimePanelLastUpdated")}: ${formatTimelineTime(
                  effectiveTimeline.lastEmittedAt,
                  isHydrated,
                )}`}
          </p>
        </div>
        <Badge variant={connectionBadgeVariant(effectiveTimeline.connectionState)}>
          {connectionLabel(effectiveTimeline.connectionState)}
        </Badge>
      </div>

      {effectiveTimeline.currentRun ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant={statusBadgeVariant(effectiveTimeline.currentRun.status)}>
              {runStatusLabel(effectiveTimeline.currentRun.status)}
            </Badge>
            <span className="truncate text-xs text-sidebar-foreground/80">
              {stageLabel(effectiveTimeline.currentRun.stage)}
            </span>
          </div>

          {effectiveTimeline.currentRun.activeTools.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[11px] font-medium tracking-wide text-sidebar-foreground/70 uppercase">
                {t("pages.appShell.runtimePanelActiveTools")}
              </p>
              <ul className="space-y-2">
                {effectiveTimeline.currentRun.activeTools.map((tool) => (
                  <li
                    className="rounded-md border border-sidebar-border/50 px-2 py-2"
                    key={`${effectiveTimeline.currentRun?.runId}-${tool.toolName}`}
                  >
                    <p className="truncate text-xs font-medium">{tool.toolName}</p>
                    <p className="mt-1 text-[11px] text-sidebar-foreground/70">
                      {tool.summary}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {effectiveTimeline.recentActivity.length > 0 ? (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] font-medium tracking-wide text-sidebar-foreground/70 uppercase">
            {t("pages.appShell.runtimePanelRecentActivity")}
          </p>
          <ul className="space-y-2">
            {effectiveTimeline.recentActivity.slice(0, 6).map((item) => (
              <li
                className="rounded-md border border-sidebar-border/50 px-2 py-2"
                key={item.eventId}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium">
                    {item.toolName ?? runtimeEventLabel(item.eventType)}
                  </span>
                  <Badge variant={statusBadgeVariant(item.runStatus)}>
                    {runStatusLabel(item.runStatus)}
                  </Badge>
                </div>
                <p className="mt-1 text-[11px] text-sidebar-foreground/70">
                  {item.summary}
                </p>
                <p className="mt-1 text-[10px] text-sidebar-foreground/55">
                  {formatTimelineTime(item.emittedAt, isHydrated)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!hasActivity ? (
        <p className="mt-3 text-xs text-sidebar-foreground/65">
          {t("pages.appShell.runtimePanelEmpty")}
        </p>
      ) : null}

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
