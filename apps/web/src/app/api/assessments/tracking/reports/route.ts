import {
  customerTrackingListQuerySchema,
  customerTrackingReportsSchema,
} from "@lcsp/contracts/assessment-domain";
import { proxyTrackingJson } from "@/lib/server/tracking-proxy";
import type { NextRequest } from "next/server";

/**
 * Business purpose: Return the customer's paginated Final Report tracking list.
 * Business rules:
 * - Report filters follow the shared query contract and upstream enforces owner scope.
 * Execution flow:
 * 1. Validate list parameters and proxy the authenticated report request.
 * Failure cases:
 * - Invalid queries, missing sessions, or invalid upstream data return shared problems.
 * Side effects:
 * - Performs one read-only upstream request without changing report artifacts.
 */
export function GET(request: NextRequest) {
  return proxyTrackingJson(
    request,
    "/assessments/tracking/reports",
    customerTrackingListQuerySchema,
    customerTrackingReportsSchema,
  );
}
