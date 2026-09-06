"use client";

import { useMemo } from "react";

import { useAssessmentInterviewStateQuery } from "../../../lib/api/assessment-queries";
import { useWorkspaceRuntime } from "../components/organisms/workspace-runtime-provider";
import type { NormalizedAssessmentRuntime } from "../types/assessment-runtime-adapter.types";
import { normalizeAssessmentRuntime } from "../utils/assessment-runtime-adapter";

export function useAssessmentRuntimeViewModel(
  assessmentId: string,
  interviewEnabled = true,
): NormalizedAssessmentRuntime {
  const workspaceRuntime = useWorkspaceRuntime();
  const timeline = workspaceRuntime.getAssessmentRuntime(assessmentId);
  const interviewQuery = useAssessmentInterviewStateQuery(
    assessmentId,
    interviewEnabled,
  );
  const repositorySnapshot =
    workspaceRuntime.repositorySnapshots
      .filter((snapshot) => snapshot.assessmentId === assessmentId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ??
    null;
  const scanJobs = workspaceRuntime.scanJobs.filter(
    (scanJob) => scanJob.assessmentId === assessmentId,
  );
  const evidenceReports = workspaceRuntime.evidenceReports.filter(
    (report) => report.assessmentId === assessmentId,
  );

  return useMemo(() => {
    return normalizeAssessmentRuntime({
      assessmentId,
      interviewState: interviewQuery,
      timeline: { ...timeline, repositorySnapshot, scanJobs, evidenceReports },
    });
  }, [assessmentId, interviewQuery, timeline, repositorySnapshot, scanJobs, evidenceReports]);
}
