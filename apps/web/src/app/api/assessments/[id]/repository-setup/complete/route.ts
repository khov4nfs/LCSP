import type { NextRequest } from "next/server";
import {
  completeAssessmentRepositorySetupBodySchema,
  completeAssessmentRepositorySetupResultSchema,
} from "@lcsp/contracts/assessment-domain";
import { proxyAssessmentJson } from "@/lib/server/assessment-domain-proxy";

/**
 * Business purpose: Complete repository setup for the signed-in customer by pinning the exact repository snapshots they chose.
 * Business rules:
 * - The body names the snapshots to pin (one to five) and is validated against the shared contract before it reaches the API;
 *   an absent body is read as "no explicit list" so older clients keep working.
 * - Session, assessment id and the upstream answer are validated by the shared assessment proxy, never re-implemented here.
 * Execution flow:
 * 1. Resolve the assessment id from the route.
 * 2. Forward the validated body upstream and validate the answer shape.
 * Failure cases:
 * - A missing session, invalid id or body, upstream problem or malformed answer is returned as a problem response.
 * Side effects:
 * - One authenticated upstream request that pins the repository set and activates the assessment.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return proxyAssessmentJson(
    request,
    (await params).id,
    "/repository-setup/complete",
    {
      method: "POST",
      bodySchema: completeAssessmentRepositorySetupBodySchema,
      responseSchema: completeAssessmentRepositorySetupResultSchema,
    },
  );
}
