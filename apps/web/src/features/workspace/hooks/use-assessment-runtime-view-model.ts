"use client";

import { useEffect, useMemo } from "react";

import {
  useAssessmentArtifactsQuery,
  useAssessmentInterviewStateQuery,
  useReadinessStatusQuery,
} from "../../../lib/api/assessment-queries";
import { useAssessmentRuntimeControl } from "@/lib/api/assessment-runtime-control-queries";
import { API_OUTCOME_KINDS } from "../../../lib/api/outcome-kinds";
import { useWorkspaceRuntime } from "../components/organisms/workspace-runtime-provider";
import type { NormalizedAssessmentRuntime } from "../types/assessment-runtime-adapter.types";
import { normalizeAssessmentRuntime } from "../utils/assessment-runtime-adapter";
import { applyAssessmentRuntimeControlPresentation } from "../utils/assessment-runtime-control-presentation";
import { projectAssessmentRuntimeUsage } from "../utils/assessment-runtime-usage";

export function useAssessmentRuntimeViewModel(
  assessmentId: string,
  interviewEnabled = true,
): NormalizedAssessmentRuntime {
  const workspaceRuntime = useWorkspaceRuntime();
  const timeline = workspaceRuntime.getAssessmentRuntime(assessmentId);
  const runtimeControl = useAssessmentRuntimeControl(assessmentId);
  const subscribeAssessmentRuntime =
    workspaceRuntime.subscribeAssessmentRuntime;
  useEffect(() => {
    return subscribeAssessmentRuntime(assessmentId);
  }, [assessmentId, subscribeAssessmentRuntime]);
  const interviewQuery = useAssessmentInterviewStateQuery(
    assessmentId,
    interviewEnabled,
  );
  const readinessQuery = useReadinessStatusQuery(assessmentId);
  const repositorySetup =
    readinessQuery.data?.kind === API_OUTCOME_KINDS.loaded
      ? readinessQuery.data.data.repositorySetup
      : null;
  const artifactQuery = useAssessmentArtifactsQuery(assessmentId);
  const repositorySnapshot =
    workspaceRuntime.repositorySnapshots
      .filter((snapshot) => snapshot.assessmentId === assessmentId)
      .sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      )[0] ?? null;
  const scanJobs = workspaceRuntime.scanJobs.filter(
    (scanJob) => scanJob.assessmentId === assessmentId,
  );
  const evidenceReports = workspaceRuntime.evidenceReports.filter(
    (report) => report.assessmentId === assessmentId,
  );

  return useMemo(() => {
    const normalized = normalizeAssessmentRuntime({
      assessmentId,
      repositorySetup,
      interviewState: interviewQuery,
      artifactState: artifactQuery,
      timeline: { ...timeline, repositorySnapshot, scanJobs, evidenceReports },
    });
    const events = timeline.agentStreamEvents ?? [];
    const runId = timeline.latestRunId ?? timeline.currentRun?.runId ?? null;
    normalized.tokenUsage = projectAssessmentRuntimeUsage(
      events,
      runId,
      runtimeControl.control.data,
    );
    return applyAssessmentRuntimeControlPresentation(
      normalized,
      events,
      runtimeControl.control.data,
    );
  }, [
    assessmentId,
    repositorySetup,
    interviewQuery,
    artifactQuery,
    timeline,
    repositorySnapshot,
    scanJobs,
    evidenceReports,
    runtimeControl.control.data,
  ]);
}
