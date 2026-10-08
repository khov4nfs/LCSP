"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  legalPortfolioHistorySchema,
  legalPreparationRunSchema,
  legalPreparationStartRequestSchema,
  type LegalPreparationStartRequest,
} from "@lcsp/contracts/legal-portfolio";
import { apiValidated } from "./api-request";
const historyKey = ["admin", "legal-portfolios"];
export function useLegalPortfolioHistoryQuery() {
  return useQuery({
    queryKey: historyKey,
    queryFn: () =>
      apiValidated("/api/admin/legal-portfolios", legalPortfolioHistorySchema),
    refetchInterval: 5000,
  });
}
export function useStartLegalPreparationMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: LegalPreparationStartRequest) =>
      apiValidated(
        "/api/admin/legal-portfolios/preparations",
        legalPreparationRunSchema,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(legalPreparationStartRequestSchema.parse(input)),
        },
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: historyKey }),
  });
}
