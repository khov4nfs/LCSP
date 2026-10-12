"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assessmentRuntimeControl } from "./assessment-runtime-control-client";
import { mergeRuntimeControlResponse } from "./assessment-runtime-control-state";
import type { AssessmentRuntimeControlResult } from "@lcsp/contracts/evidence";

export function useAssessmentRuntimeControl(assessmentId: string) {
  const client = useQueryClient();
  const queryKey = ["assessment-runtime-control", assessmentId];
  const control = useQuery({
    queryKey,
    queryFn: () => assessmentRuntimeControl(assessmentId, "control"),
    refetchInterval: 1000,
  });
  const beginRequest = async (targetRunId: string | undefined) => {
    const previousTargetRunId =
      client.getQueryData<AssessmentRuntimeControlResult | null>(
        queryKey,
      )?.targetRunId;
    await client.cancelQueries({ queryKey });
    return { targetRunId, previousTargetRunId };
  };
  const stop = useMutation({
    mutationFn: (targetRunId: string | undefined) =>
      assessmentRuntimeControl(assessmentId, "stop", targetRunId),
    onMutate: beginRequest,
    onSuccess: (value, _targetRunId, request) =>
      client.setQueryData<AssessmentRuntimeControlResult | null>(
        queryKey,
        (current) => mergeRuntimeControlResponse(current, value, request),
      ),
    onSettled: () => client.invalidateQueries({ queryKey }),
  });
  const resume = useMutation({
    mutationFn: (targetRunId: string | undefined) =>
      assessmentRuntimeControl(assessmentId, "continue", targetRunId),
    onMutate: beginRequest,
    onSuccess: (value, _targetRunId, request) =>
      client.setQueryData<AssessmentRuntimeControlResult | null>(
        queryKey,
        (current) => mergeRuntimeControlResponse(current, value, request),
      ),
    onSettled: () => client.invalidateQueries({ queryKey }),
  });
  return { control, stop, resume };
}
