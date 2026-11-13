"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentExecutionState,
  AssessmentLifecycleState,
} from "@lcsp/contracts/assessment";
import type {
  AssessmentDetail,
} from "@lcsp/contracts/assessment-domain";
import type { AssessmentRuntimeControlResult } from "@lcsp/contracts/evidence";
import type { CustomerAssessmentState } from "../../features/assessment-runtime/config/customer-assessment-states";
import type { WorkspaceRuntimeConnectionState } from "../../features/workspace/types/workspace-runtime.types";
import { assessmentRuntimeControl } from "./assessment-runtime-control-client";
import {
  computeRuntimeControlPollingInterval,
  type AssessmentAuditMode,
  type RuntimeControlPollingContext,
} from "./assessment-runtime-control-polling-policy";
import { mergeRuntimeControlResponse } from "./assessment-runtime-control-state";

export type UseAssessmentRuntimeControlOptions = {
  lifecycleState?: AssessmentLifecycleState | null;
  executionState?: AgentExecutionState | null;
  customerState?: CustomerAssessmentState | null;
  auditMode?: AssessmentAuditMode | null;
  targetRunId?: string | null;
  connectionState?: WorkspaceRuntimeConnectionState | null;
};

/**
 * Business purpose:
 * Manage customer runtime control interactions (querying runtime state, requesting cooperative stop,
 * and resuming paused assessments) with state-aware polling intervals and target-run fencing.
 *
 * Business rules:
 * - Runtime control queries must poll with dynamic intervals computed by `computeRuntimeControlPollingInterval`:
 *   fast 1,000ms polling during transitions, 2,000ms-3,000ms during active execution, 5,000ms-10,000ms during
 *   idle/waiting/paused states, and disabled/bounded reconciliation for terminal states.
 * - Scheduled polling is suspended when the browser tab is hidden; window focus immediately triggers a fresh refetch.
 * - When in-flight stop or resume mutations occur, in-flight queries are cancelled and optimistic transition states
 *   are fenced using `targetRunId` and `previousTargetRunId` so stale responses never downgrade newer runs.
 * - On settlement of mutations, the runtime control query is invalidated to synchronize with authoritative backend state.
 *
 * Execution flow:
 * 1. Define query key scoped to `assessmentId`.
 * 2. Configure `stop` and `resume` mutations with `cancelQueries` on mutate, `mergeRuntimeControlResponse` on success,
 *    and query invalidation on settlement.
 * 3. Configure `useQuery` with dynamic `refetchInterval` that inspects caller options, cached assessment detail,
 *    current query status, document visibility, and pending mutations.
 * 4. Enforce `refetchIntervalInBackground: false`, `refetchOnWindowFocus: true`, and `refetchOnReconnect: true`.
 * 5. Return `{ control, stop, resume }` handles.
 *
 * Failure cases:
 * - Network or server errors in the control query back off to 10,000ms to avoid request storms.
 * - Stale responses from superseded runs are safely ignored by `mergeRuntimeControlResponse`.
 *
 * Side effects:
 * - Dispatches authenticated HTTP GET/POST requests to `/api/assessments/[id]/runtime/*`.
 * - Updates and invalidates TanStack Query cache entries under `["assessment-runtime-control", assessmentId]`.
 */
export function useAssessmentRuntimeControl(
  assessmentId: string,
  options?: UseAssessmentRuntimeControlOptions,
) {
  const client = useQueryClient();
  const queryKey = ["assessment-runtime-control", assessmentId];

  const beginRequest = async (targetRunId: string | undefined) => {
    const previousTargetRunId =
      client.getQueryData<AssessmentRuntimeControlResult | null>(
        queryKey,
      )?.targetRunId;
    await client.cancelQueries({ queryKey });
    return { targetRunId, previousTargetRunId };
  };

  const stop = useMutation({
    mutationKey: ["assessment-runtime-control", assessmentId, "stop"],
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
    mutationKey: ["assessment-runtime-control", assessmentId, "continue"],
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

  const control = useQuery({
    queryKey,
    queryFn: () => assessmentRuntimeControl(assessmentId, "control"),
    /**
     * Business purpose:
     * Dynamically compute the runtime control polling schedule based on live query data, caller options, and connectivity.
     *
     * Business rules:
     * - Hidden tabs suspend polling; active transitions poll at 1,000ms; active runs poll at 2,000ms-3,000ms;
     *   paused/waiting states back off to 5,000ms-10,000ms; terminal states disable or bound to 30,000ms fallback.
     *
     * Execution flow:
     * 1. Inspect caller options, cached assessment detail, visibility, error status, and pending mutations.
     * 2. Delegate to computeRuntimeControlPollingInterval to determine the appropriate polling interval.
     *
     * Failure cases:
     * - Query errors yield a 10,000ms backoff interval to protect upstream services.
     *
     * Side effects:
     * - Pure schedule calculation; performs no cache mutation or HTTP calls.
     */
    refetchInterval: (query) => {
      const cachedDetail = client.getQueryData<AssessmentDetail>([
        "assessment",
        assessmentId,
      ]);
      const isVisible =
        typeof document !== "undefined"
          ? document.visibilityState !== "hidden"
          : true;
      const isMutating = stop.isPending || resume.isPending;
      const hasQueryError = query.state.status === "error";

      const context: RuntimeControlPollingContext = {
        controlState: query.state.data?.state,
        targetRunId:
          query.state.data?.targetRunId ??
          options?.targetRunId ??
          cachedDetail?.runtime?.currentExecutionId,
        lifecycleState:
          options?.lifecycleState ?? cachedDetail?.lifecycle?.state,
        executionState:
          options?.executionState ?? cachedDetail?.runtime?.executionState,
        customerState: options?.customerState,
        auditMode: options?.auditMode ?? cachedDetail?.case?.auditMode,
        connectionState: options?.connectionState,
        isMutating,
        hasQueryError,
        isDocumentVisible: isVisible,
      };

      return computeRuntimeControlPollingInterval(context);
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  return { control, stop, resume };
}
