import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import {
  customerUsageAnalyticsSchema,
  customerUsageQuerySchema,
  type CustomerUsageAnalytics,
  type CustomerUsageQuery,
} from "@lcsp/contracts/billing";

import { ApiRequestError, apiValidated } from "./api-request";

/**
 * Business purpose: Load the signed-in customer's usage for an explicit reporting interval.
 * Business rules:
 * - Validate customer-only filters and public results through shared contracts.
 * - Delegate credentials, envelope parsing and expired-session handling to the shared API client.
 * Execution flow:
 * 1. Validate filters, serialize defined parameters and request the public report.
 * Failure cases:
 * - Invalid filters, malformed payloads, API problems and transport failures reject the read.
 * Side effects:
 * - One cancellable BFF read; no usage or billing mutations.
 */
export async function getCustomerUsage(
  query: CustomerUsageQuery,
  signal?: AbortSignal,
): Promise<CustomerUsageAnalytics> {
  const validated = customerUsageQuerySchema.parse(query);
  const params = new URLSearchParams(
    Object.entries(validated)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
  return apiValidated(
    `/api/billing/usage?${params}`,
    customerUsageAnalyticsSchema,
    { signal },
  );
}

/**
 * Business purpose: Distinguish customer usage role denial from a retryable report-read failure.
 * Business rules:
 * - Only the shared RBAC denial code maps to the customer-only explanation.
 * Execution flow:
 * 1. Recognize the shared API error and compare its problem code with the role-denial contract.
 * Failure cases:
 * - Transport, schema and other API failures remain ordinary load failures.
 * Side effects:
 * - Pure domain error classification; no navigation or persistence.
 */
export function isCustomerUsageForbidden(error: unknown): boolean {
  return (
    error instanceof ApiRequestError &&
    error.problemCode === AUTH_ERROR_CODES.rbacDenied
  );
}
