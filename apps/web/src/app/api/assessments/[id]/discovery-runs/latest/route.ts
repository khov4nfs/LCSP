import type { NextRequest } from "next/server";
import { assessmentDiscoveryLatestRunSchema } from "@lcsp/contracts/assessment-domain";
import { proxyAssessmentJson } from "@/lib/server/assessment-domain-proxy";

/**
 * Business purpose: Restore an authorized customer's last discovery state after reload.
 * Business rules:
 * - Exact assessment ownership, snapshot and result verification remain in the API.
 * Execution flow:
 * 1. Resolve assessment ID and proxy the current pinned run lookup.
 * Failure cases:
 * - Invalid session, ownership or upstream response fails without fabricated discovery.
 * Side effects:
 * - Read-only authenticated API request.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return proxyAssessmentJson(
    request,
    (await params).id,
    "/discovery-runs/latest",
    {
      responseSchema: assessmentDiscoveryLatestRunSchema,
    },
  );
}
