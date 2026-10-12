"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchAdminBilling,
  type AdminBillingQuery,
} from "./admin-billing-client";
import { apiQueryKeys } from "./query-keys";

export function useAdminBillingQuery(query: AdminBillingQuery) {
  return useQuery({
    queryKey: apiQueryKeys.admin.billing(
      query.period,
      query.status,
      query.gateway,
      query.page,
      query.pageSize,
    ),
    queryFn: () => fetchAdminBilling(query),
  });
}
