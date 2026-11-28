"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BILLING_ERROR_CODES,
  adminModelPricingOverviewQuerySchema,
  adminModelPricingOverviewResponseSchema,
  type AdminModelPricingOverviewQuery,
} from "@lcsp/contracts/billing";
import { apiRequest } from "./api-request";
import { apiQueryKeys } from "./query-keys";

/**
 * Business purpose: Subscribe to the read-only Admin Model Pricing overview for the selected filters.
 *
 * Business rules:
 * - Include the normalized query object in `apiQueryKeys.admin.modelPricing` so filter transitions
 *   invalidate and cache independently.
 * - Validate both outbound query parameters and inbound response payloads against `@lcsp/contracts/billing`.
 *
 * Execution flow:
 * 1. Register a TanStack Query subscription keyed by `apiQueryKeys.admin.modelPricing(query)`.
 * 2. Execute the read-only BFF loader inside `queryFn` and return the typed query state.
 *
 * Failure cases:
 * - BFF HTTP failures, schema mismatches, or `debitMode: "ON"` payloads surface as query errors so
 *   the UI fails closed with an error alert rather than showing fallback rates.
 *
 * Side effects:
 * - Registers a read-only React Query subscription against `/api/admin/billing/model-pricing`.
 */
export function useAdminModelPricingOverviewQuery(
  query: AdminModelPricingOverviewQuery = {},
) {
  return useQuery({
    queryKey: apiQueryKeys.admin.modelPricing(query),
    /**
     * Business purpose: Fetch and strictly validate the Admin Model Pricing overview from the Next.js BFF.
     *
     * Business rules:
     * - Strip undefined filter entries before constructing query parameters.
     * - Reject non-`ok` envelopes and any response failing `adminModelPricingOverviewResponseSchema`.
     *
     * Execution flow:
     * 1. Validate `query` with `adminModelPricingOverviewQuerySchema.parse`.
     * 2. Serialize defined entries into `URLSearchParams` and invoke `apiRequest`.
     * 3. Throw on error envelopes and parse the payload with `adminModelPricingOverviewResponseSchema`.
     *
     * Failure cases:
     * - Throws an Error carrying the reported `problemCode` (or `BILLING_VALIDATION_FAILED`) on failure.
     * - Throws ZodError if the BFF payload violates strict contract schemas.
     *
     * Side effects:
     * - Executes one read-only HTTP GET to `/api/admin/billing/model-pricing`; no pricing mutations.
     */
    queryFn: async () => {
      // Why: Enforce contract compliance on both outgoing filter parameters and incoming BFF payloads.
      // How: Parse query via Zod, omit undefined keys from URLSearchParams, call shared `apiRequest`, and validate response.
      // Invariants: Zero mutation requests and strict rejection of uncontracted fields or `debitMode: "ON"`.
      const validatedQuery = adminModelPricingOverviewQuerySchema.parse(query);
      const params = new URLSearchParams(
        Object.entries(validatedQuery)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => [key, String(value)]),
      );
      const url =
        params.size > 0
          ? `/api/admin/billing/model-pricing?${params.toString()}`
          : "/api/admin/billing/model-pricing";
      const response = await apiRequest(url);
      if (!response.ok) {
        throw new Error(
          response.problemCode ?? BILLING_ERROR_CODES.validationFailed,
        );
      }
      return adminModelPricingOverviewResponseSchema.parse(response.payload);
    },
  });
}
