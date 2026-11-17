import type { NextRequest } from "next/server";
import { repositoryDiscoveryDetailPageSchema } from "@lcsp/contracts/assessment-domain";
import { proxyAssessmentJson } from "@/lib/server/assessment-domain-proxy";

/**
 * Business purpose: Let an authorized customer inspect all discovery candidates in bounded pages.
 * Business rules:
 * - The API keeps exact discovery-run authority; the BFF forwards only bounded query parameters.
 * Execution flow:
 * 1. Read run identity and pagination controls and proxy a validated owner-scoped page.
 * Failure cases:
 * - Invalid or unauthorized pages fail with canonical API problem details.
 * Side effects:
 * - Read-only owner-authenticated request.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await params;
  const query = new URL(request.url).searchParams;
  const collection = query.get("collection") ?? "";
  const offset = query.get("offset") ?? "0";
  const limit = query.get("limit") ?? "100";
  return proxyAssessmentJson(
    request,
    id,
    `/discovery-runs/${encodeURIComponent(runId)}/details?collection=${encodeURIComponent(collection)}&offset=${encodeURIComponent(offset)}&limit=${encodeURIComponent(limit)}`,
    { responseSchema: repositoryDiscoveryDetailPageSchema },
  );
}
