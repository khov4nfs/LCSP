import {
  customerTrackingObligationsSchema,
  customerTrackingListQuerySchema,
} from "@lcsp/contracts/assessment-domain";
import { proxyTrackingJson } from "@/lib/server/tracking-proxy";
import type { NextRequest } from "next/server";

/**
 * Business purpose: Return the customer's filtered obligation summary for the compliance view.
 * Business rules:
 * - Query paging and filters follow the shared contract; upstream owner checks remain authoritative.
 * Execution flow:
 * 1. Validate the list query and proxy the authenticated obligation summary request.
 * Failure cases:
 * - Invalid queries, missing sessions, or invalid upstream data return shared problems.
 * Side effects:
 * - Performs one read-only upstream request without changing obligations.
 */
export function GET(request: NextRequest) {
  return proxyTrackingJson(
    request,
    "/assessments/tracking/obligations",
    customerTrackingListQuerySchema,
    customerTrackingObligationsSchema,
  );
}
