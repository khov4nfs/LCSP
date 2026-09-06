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

  return useMemo(() => {
    return normalizeAssessmentRuntime({
      assessmentId,
      interviewState: interviewQuery,
      timeline,
    });
  }, [assessmentId, interviewQuery, timeline]);
}
