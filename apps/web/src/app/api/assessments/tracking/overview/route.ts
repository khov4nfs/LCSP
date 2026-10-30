import {
  customerTrackingOverviewQuerySchema,
  customerTrackingOverviewSchema,
} from "@lcsp/contracts/assessment-domain";
import { proxyTrackingJson } from "@/lib/server/tracking-proxy";
import type { NextRequest } from "next/server";

/**
 * Business purpose: Return the customer's tracking overview for the workspace dashboard.
 * Business rules:
 * - Overview filters follow the shared contract and upstream enforces customer ownership.
 * Execution flow:
 * 1. Validate overview parameters and proxy the authenticated tracking request.
 * Failure cases:
 * - Invalid queries, missing sessions, or invalid upstream data return shared problems.
 * Side effects:
 * - Performs one read-only upstream request without changing assessments.
 */
export function GET(request: NextRequest) {
  return proxyTrackingJson(
    request,
    "/assessments/tracking/overview",
    customerTrackingOverviewQuerySchema,
    customerTrackingOverviewSchema,
  );
}
