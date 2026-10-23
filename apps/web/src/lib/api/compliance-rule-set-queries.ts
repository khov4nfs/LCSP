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
export function useComplianceRuleSetResultQuery(ruleSetVersionId: string) {
  return useQuery({
    queryKey: [...historyKey, "result", ruleSetVersionId],
    queryFn: () =>
      apiValidated(
        `/api/admin/compliance-rule-sets/${encodeURIComponent(ruleSetVersionId)}`,
        complianceRuleSetResultSchema,
      ),
  });
}
export function usePrepareRuleSetMutation() {
  const client = useQueryClient();
  return useMutation({
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
