"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  complianceRuleSetHistorySchema,
  ruleSetPreparationRunSchema,
} from "@lcsp/contracts/compliance-rule-set";
import { apiValidated } from "./api-request";
const historyKey = ["admin", "compliance-rule-sets"];
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
/** Retries one FAILED Rule Set Preparation of the same Legal Source Version; there is no start mutation. */
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
