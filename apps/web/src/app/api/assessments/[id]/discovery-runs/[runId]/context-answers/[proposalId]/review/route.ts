import type { NextRequest } from "next/server";
import {
  discoveryInterviewProposalSchema,
  reviewDiscoveryInterviewAnswerSchema,
} from "@lcsp/contracts/assessment-domain";
import { proxyAssessmentJson } from "@/lib/server/assessment-domain-proxy";

/**
 * Business purpose: Submit an explicit owner decision on a pending Discovery context answer.
 * Business rules:
 * - An ACCEPT action cannot bypass the API's uncertainty, canonical FactNeed or case revision gates.
 * Execution flow:
 * 1. Validate the owner's confirmation/rejection and delegate its atomic settlement to the API.
 * Failure cases:
 * - Stale case revisions, invalid answers or nonpending proposals reject.
 * Side effects:
 * - The API may accept a human fact or close a rejected proposal.
 */
export async function POST(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ id: string; runId: string; proposalId: string }> },
) {
  const { id, runId, proposalId } = await params;
  return proxyAssessmentJson(
    request,
    id,
    `/discovery-runs/${encodeURIComponent(runId)}/context-answers/${encodeURIComponent(proposalId)}/review`,
    {
      method: "POST",
      bodySchema: reviewDiscoveryInterviewAnswerSchema,
      responseSchema: discoveryInterviewProposalSchema,
    },
  );
}
