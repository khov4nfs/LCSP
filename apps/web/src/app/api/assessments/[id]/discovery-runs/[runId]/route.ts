import type { NextRequest } from "next/server";
import { assessmentDiscoveryRunViewSchema } from "@lcsp/contracts/assessment-domain";
import { proxyAssessmentJson } from "@/lib/server/assessment-domain-proxy";

/**
 * Business purpose: Return an exact durable pre-scope discovery status and bounded result.
 * Business rules:
 * - The run identity remains owner and pinned-snapshot scoped in the API.
 * Execution flow:
 * 1. Resolve route IDs and request the exact API discovery run.
 * Failure cases:
 * - Missing, foreign, or invalid runs fail with a typed upstream problem.
 * Side effects:
 * - Read-only authenticated API request.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await params;
  return proxyAssessmentJson(
    request,
    id,
    `/discovery-runs/${encodeURIComponent(runId)}`,
    { responseSchema: assessmentDiscoveryRunViewSchema },
  );
}
