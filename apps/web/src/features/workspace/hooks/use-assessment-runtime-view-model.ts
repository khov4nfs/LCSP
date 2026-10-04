"use client";

import { useEffect, useMemo } from "react";

import {
  useAssessmentArtifactsQuery,
  useAssessmentInterviewStateQuery,
} from "../../../lib/api/assessment-queries";
import { useAssessmentRuntimeControl } from "@/lib/api/assessment-runtime-control-queries";
import { useWorkspaceRuntime } from "../components/organisms/workspace-runtime-provider";
import type { NormalizedAssessmentRuntime } from "../types/assessment-runtime-adapter.types";
import { normalizeAssessmentRuntime } from "../utils/assessment-runtime-adapter";
import { applyAssessmentRuntimeControlPresentation } from "../utils/assessment-runtime-control-presentation";

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
      interviewState: interviewQuery,
      artifactState: artifactQuery,
      timeline: { ...timeline, repositorySnapshot, scanJobs, evidenceReports },
    });
    return applyAssessmentRuntimeControlPresentation(
      normalized,
      timeline.agentStreamEvents ?? [],
      runtimeControl.control.data,
    );
  }, [
    assessmentId,
    interviewQuery,
    artifactQuery,
    timeline,
    repositorySnapshot,
    scanJobs,
    evidenceReports,
    runtimeControl.control.data,
  ]);
}
