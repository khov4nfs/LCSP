"use client";
import { useQuery } from "@tanstack/react-query";
import {
  adminUsageQuerySchema,
  adminUsageAnalyticsSchema,
  BILLING_ERROR_CODES,
  type AdminUsageQuery,
} from "@lcsp/contracts/billing";
import { apiRequest } from "./api-request";
import { apiQueryKeys } from "./query-keys";
export function useAdminUsageQuery(query: AdminUsageQuery) {
  return useQuery({
    queryKey: apiQueryKeys.admin.usage(query),
    queryFn: async () => {
      const validated = adminUsageQuerySchema.parse(query);
      const params = new URLSearchParams(
        Object.entries(validated)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)]),
      );
      const response = await apiRequest(`/api/admin/usage?${params}`);
      if (!response.ok)
        throw new Error(
          response.problemCode ?? BILLING_ERROR_CODES.validationFailed,
        );
      return adminUsageAnalyticsSchema.parse(response.payload);
    },
  });
}
