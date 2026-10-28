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
/**
 * Business purpose: Subscribe to Admin usage analytics for the selected filters.
 *
 * Business rules:
 * - Include the supplied filters in the query key; request and response validation belongs to
 *   the loader.
 *
 * Execution flow:
 * 1. Register the filter-scoped analytics query.
 *
 * Failure cases:
 * - Loader failures remain query errors rather than empty analytics.
 *
 * Side effects:
 * - Registers the React Query subscription.
 */
export function useAdminUsageQuery(query: AdminUsageQuery) {
  return useQuery({
    queryKey: apiQueryKeys.admin.usage(query),
    /**
     * Business purpose: Load Admin usage without accepting malformed filters or analytics.
     *
     * Business rules:
     * - Normalize filters with adminUsageQuerySchema, omit undefined parameters and validate
     *   adminUsageAnalyticsSchema.
     *
     * Execution flow:
     * 1. Validate/serialize filters, fetch the shared API result and parse its payload.
     *
     * Failure cases:
     * - Invalid filters/payloads throw schema errors; failed API results throw the reported
     *   billing code or validationFailed.
     *
     * Side effects:
     * - One BFF analytics read; no accounting state changes.
     */
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
