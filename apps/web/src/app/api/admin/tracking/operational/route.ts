import { z } from "zod";
import { adminTrackingOperationalSchema } from "@lcsp/contracts/assessment-domain";
import { proxyTrackingJson } from "@/lib/server/tracking-proxy";
import type { NextRequest } from "next/server";

/**
 * Business purpose: Return the Admin operational tracking snapshot through the authenticated BFF route.
 * Business rules:
 * - Only a valid session may read the Admin projection; upstream authorization remains authoritative.
 * Execution flow:
 * 1. Validate the empty query and proxy the request to the Admin tracking endpoint.
 * Failure cases:
 * - Missing sessions, rejected upstream access, or invalid payloads return shared problem responses.
 * Side effects:
 * - Performs one read-only upstream request; no tracking records are changed.
 */
export function GET(request: NextRequest) {
  return proxyTrackingJson(
    request,
    "/admin/tracking/operational",
    z.strictObject({}),
    adminTrackingOperationalSchema,
  );
}
