"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  complianceRuleSetHistorySchema,
  complianceRuleSetResultSchema,
  ruleSetPreparationRunSchema,
  RULE_SET_PREPARATION_REFUSAL_REASONS,
  type ComplianceRuleSetHistory,
  type RuleSetPreparationAdminRequest,
} from "@lcsp/contracts/compliance-rule-set";
import { apiValidated } from "./api-request";
const historyKey = ["admin", "compliance-rule-sets"];
export const RULE_SET_PREPARATION_CANCEL_MUTATION_KEY = [
  "admin",
  "compliance-rule-sets",
  "cancel-preparation",
] as const;
export function useComplianceRuleSetHistoryQuery() {
  return useQuery({
    queryKey: historyKey,
    queryFn: () =>
      apiValidated(
        "/api/admin/compliance-rule-sets",
        complianceRuleSetHistorySchema,
      ),
    refetchInterval: 5000,
  });
}
/**
 * Business purpose: Cache the Admin result of one immutable Rule Set version.
 *
 * Business rules:
 * - Key the result by its supplied version ID and use the shared validated API client.
 *
 * Execution flow:
 * 1. Register the version-scoped query and its typed result loader.
 *
 * Failure cases:
 * - API, schema and transport failures remain query errors; no fallback result is invented.
 *
 * Side effects:
 * - Registers a React Query subscription; fetching occurs through its loader.
 */
export function useComplianceRuleSetResultQuery(ruleSetVersionId: string) {
  return useQuery({
    queryKey: [...historyKey, "result", ruleSetVersionId],
    /**
     * Business purpose: Retrieve the requested Rule Set result for the Admin query cache.
     *
     * Business rules:
     * - Encode the requested version ID and require complianceRuleSetResultSchema.
     *
     * Execution flow:
     * 1. Call the shared validated client for that result endpoint.
     *
     * Failure cases:
     * - Client/API/schema failures reject the query.
     *
     * Side effects:
     * - One authenticated BFF read.
     */
    queryFn: () =>
      apiValidated(
        `/api/admin/compliance-rule-sets/${encodeURIComponent(ruleSetVersionId)}`,
        complianceRuleSetResultSchema,
      ),
  });
}
/**
 * Business purpose: Coordinate Admin Preparation submission and history-cache refresh.
 *
 * Business rules:
 * - Only an acknowledged server run updates existing history; preserve the active Rule Set
 *   identity and let the API enforce admission.
 *
 * Execution flow:
 * 1. Register the POST mutation, acknowledged-run cache update and settled history
 *   invalidation.
 *
 * Failure cases:
 * - A failed request remains a mutation error; absent cached history is not manufactured.
 *
 * Side effects:
 * - Registers a mutation and its cache effects; the API owns actual Preparation execution.
 */
export function usePrepareRuleSetMutation() {
  const client = useQueryClient();
  return useMutation({
    /**
     * Business purpose: Submit the Admin’s validated-contract Preparation request.
     *
     * Business rules:
     * - Send the request as JSON and validate the returned Preparation run through apiValidated.
     *
     * Execution flow:
     * 1. POST the supplied request to the canonical Preparation BFF endpoint.
     *
     * Failure cases:
     * - API/schema/network errors reject the mutation.
     *
     * Side effects:
     * - One upstream Preparation request via the BFF.
     */
    mutationFn: (request: RuleSetPreparationAdminRequest) =>
      apiValidated(
        "/api/admin/compliance-rule-sets/prepare",
        ruleSetPreparationRunSchema,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        },
      ),
    /**
     * Business purpose: Project an acknowledged in-progress Preparation into existing Admin
     *   history.
     *
     * Business rules:
     * - Disable start/replace while the returned run is current; retain the existing active Rule
     *   Set and leave an absent history cache absent.
     *
     * Execution flow:
     * 1. Update cached Preparation availability, refusal reason and current run from the server
     *   result.
     *
     * Failure cases:
     * - If history was not cached, return it unchanged rather than create a guessed projection.
     *
     * Side effects:
     * - Updates only React Query history data.
     */
    onSuccess: (run) => {
      client.setQueryData<ComplianceRuleSetHistory>(historyKey, (history) =>
        history
          ? {
              ...history,
              preparation: {
                ...history.preparation,
                canStart: false,
                canReplace: false,
                activeRuleSetVersionId:
                  history.preparation.activeRuleSetVersionId,
                refusalReason:
                  RULE_SET_PREPARATION_REFUSAL_REASONS.PREPARATION_IN_PROGRESS,
                currentRun: run,
              },
            }
          : history,
      );
    },
    onSettled: () => client.invalidateQueries({ queryKey: historyKey }),
  });
}

/** Retries one FAILED Rule Set Preparation of the same Legal Source Version. */
export function useRetryRuleSetPreparationMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (preparationRunId: string) =>
      apiValidated(
        `/api/admin/compliance-rule-sets/preparations/${encodeURIComponent(preparationRunId)}/retries`,
        ruleSetPreparationRunSchema,
        { method: "POST" },
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: historyKey }),
  });
}

/** Cancels one queued/running preparation through the Admin API. */
export function useCancelRuleSetPreparationMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationKey: RULE_SET_PREPARATION_CANCEL_MUTATION_KEY,
    mutationFn: (preparationRunId: string) =>
      apiValidated(
        `/api/admin/compliance-rule-sets/preparations/${encodeURIComponent(preparationRunId)}/cancel`,
        ruleSetPreparationRunSchema,
        { method: "POST" },
      ),
    onSettled: () => client.invalidateQueries({ queryKey: historyKey }),
  });
}

/**
 * Business purpose: Coordinate resuming an existing Preparation and refreshing its history.
 *
 * Business rules:
 * - Use the same run identity; invalidate history on either success or failure so the next
 *   view follows server state.
 *
 * Execution flow:
 * 1. Register the resume POST loader and settled invalidation.
 *
 * Failure cases:
 * - Resume failures remain mutation errors; they do not imply a new run or success.
 *
 * Side effects:
 * - Registers the mutation and subsequent cache invalidation.
 */
export function useResumeRuleSetPreparationMutation() {
  const client = useQueryClient();
  return useMutation({
    /**
     * Business purpose: Request native continuation of the specified existing Preparation.
     *
     * Business rules:
     * - Encode the run ID and validate ruleSetPreparationRunSchema; backend guards decide whether
     *   resume is allowed.
     *
     * Execution flow:
     * 1. POST to the existing run’s resume BFF endpoint.
     *
     * Failure cases:
     * - API, schema or transport failures reject without fabricated run state.
     *
     * Side effects:
     * - One upstream resume request.
     */
    mutationFn: (preparationRunId: string) =>
      apiValidated(
        `/api/admin/compliance-rule-sets/preparations/${encodeURIComponent(preparationRunId)}/resume`,
        ruleSetPreparationRunSchema,
        { method: "POST" },
      ),
    /**
     * Business purpose: Refresh Admin history after any resume outcome.
     *
     * Business rules:
     * - Invalidate the shared history prefix regardless of request success.
     *
     * Execution flow:
     * 1. Return the history invalidation promise.
     *
     * Failure cases:
     * - Cache invalidation errors propagate through React Query’s mutation lifecycle.
     *
     * Side effects:
     * - Marks matching history/result queries stale and may trigger active refetches.
     */
    onSettled: () => client.invalidateQueries({ queryKey: historyKey }),
  });
}
