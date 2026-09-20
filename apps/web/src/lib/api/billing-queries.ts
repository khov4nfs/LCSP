"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BILLING_ORDER_STATUSES } from "@lcsp/contracts/billing";

import {
  createBillingOrder,
  getBillingEstimate,
  getBillingHistory,
  getBillingOrder,
  getBillingWallet,
} from "./billing-client";
import { apiQueryKeys } from "./query-keys";

export function useBillingWalletQuery() {
  return useQuery({
    queryKey: apiQueryKeys.billing.wallet(),
    queryFn: getBillingWallet,
  });
}

export function useBillingHistoryQuery(page = 1, pageSize = 20) {
  return useQuery({
    queryKey: apiQueryKeys.billing.history(page, pageSize),
    queryFn: () => getBillingHistory({ page, pageSize }),
    refetchInterval: (query) =>
      query.state.data?.orders.some(
        (order) =>
          order.status === BILLING_ORDER_STATUSES.PENDING_PAYMENT ||
          order.status === BILLING_ORDER_STATUSES.PENDING_RECONCILIATION,
      )
        ? 5_000
        : false,
  });
}

export function useBillingEstimateQuery(amountVnd: string) {
  return useQuery({
    queryKey: apiQueryKeys.billing.estimate(amountVnd),
    queryFn: () => getBillingEstimate(amountVnd),
    enabled: amountVnd.length > 0,
  });
}

export function useBillingOrderQuery(orderId: string | null) {
  return useQuery({
    queryKey: apiQueryKeys.billing.order(orderId ?? ""),
    queryFn: () => getBillingOrder(orderId as string),
    enabled: Boolean(orderId),
    retry: false,
    refetchInterval: (query) => {
      if (query.state.error) return false;
      return query.state.data?.status ===
        BILLING_ORDER_STATUSES.PENDING_PAYMENT ||
        query.state.data?.status ===
          BILLING_ORDER_STATUSES.PENDING_RECONCILIATION
        ? 5_000
        : false;
    },
  });
}

export function useCreateBillingOrderMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createBillingOrder,
    onSuccess: async (order) => {
      queryClient.setQueryData(apiQueryKeys.billing.order(order.id), order);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: apiQueryKeys.billing.wallet(),
        }),
        queryClient.invalidateQueries({ queryKey: ["billing", "history"] }),
      ]);
    },
  });
}
