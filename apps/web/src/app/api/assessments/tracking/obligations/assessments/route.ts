import {
  customerTrackingObligationAssessmentsQuerySchema,
  customerTrackingObligationAssessmentsSchema,
} from "@lcsp/contracts/assessment-domain";
import { proxyTrackingJson } from "@/lib/server/tracking-proxy";
import type { NextRequest } from "next/server";

/**
 * Business purpose: Return the customer's paginated assessments for one obligation group.
 * Business rules:
 * - The group key and filters must satisfy the shared query contract; owner scope is enforced upstream.
 * Execution flow:
 * 1. Validate query parameters and forward the authenticated obligation detail request.
 * Failure cases:
 * - Invalid filters, missing sessions, or upstream failures return shared problems.
 * Side effects:
 * - Performs one read-only upstream request; no assessment state is changed.
 */
export function GET(request: NextRequest) {
  return proxyTrackingJson(
    request,
    "/assessments/tracking/obligations/assessments",
    customerTrackingObligationAssessmentsQuerySchema,
    customerTrackingObligationAssessmentsSchema,
  );
}
