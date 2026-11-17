"use client";

import type { CustomerUsageQuery } from "@lcsp/contracts/billing";
import { useQuery } from "@tanstack/react-query";

import { getCustomerUsage } from "./customer-usage-client";
import { apiQueryKeys } from "./query-keys";

/**
 * Business purpose: Cache customer usage independently for each reporting interval, filter and page.
 * Business rules:
 * - Fetch only while the Usage panel is mounted; authentication/role failures are not retried automatically.
 * Execution flow:
 * 1. Register the complete query key and a cancellable shared-client read.
 * Failure cases:
 * - Read failures remain query errors; empty data is only a successful empty report.
 * Side effects:
 * - Populates the private query cache; requests are canceled on unmount.
 */
export function useCustomerUsageQuery(query: CustomerUsageQuery) {
  return useQuery({
    queryKey: apiQueryKeys.billing.usage(query),
    /**
     * Business purpose: Cancel obsolete customer usage reads when the report subscription changes.
     * Business rules:
     * - Forward the query cancellation signal to the shared validated loader.
     * Execution flow:
     * 1. Load the current filter and page through the cancellable BFF request.
     * Failure cases:
     * - Abort and API failures propagate to TanStack Query without empty-report substitution.
     * Side effects:
     * - Read-only HTTP request with shared session handling.
     */
    queryFn: ({ signal }) => getCustomerUsage(query, signal),
    retry: false,
  });
}
