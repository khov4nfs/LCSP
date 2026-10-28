import { reconcileOrphanedAssessmentResultSchema } from "@lcsp/contracts/assessment-domain";
import type { NextRequest } from "next/server";

import { proxyAssessmentJson } from "@/lib/server/assessment-domain-proxy";

/**
 * Business purpose: Forward the owner’s request to reconcile an Assessment stalled before
 *   Root execution.
 *
 * Business rules:
 * - Use the shared Assessment session/identity proxy and validate
 *   reconcileOrphanedAssessmentResultSchema.
 * - The API decides ownership, stale-scan eligibility and cancellation; the BFF does not
 *   infer that a running Assessment is orphaned.
 *
 * Execution flow:
 * 1. Resolve the Assessment route identity.
 * 2. POST the scoped reconciliation request through the shared proxy and validate its result.
 *
 * Failure cases:
 * - Shared session/identity validation and backend ownership/state conflicts are preserved.
 *
 * Side effects:
 * - One upstream reconciliation request that may cancel eligible never-started work.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return proxyAssessmentJson(
    request,
    (await params).id,
    "/reconcile-orphaned",
    {
      method: "POST",
      responseSchema: reconcileOrphanedAssessmentResultSchema,
    },
  );
}
