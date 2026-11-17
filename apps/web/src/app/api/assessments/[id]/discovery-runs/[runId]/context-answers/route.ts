import type { NextRequest } from "next/server";
import {
  discoveryInterviewPageQuerySchema,
  discoveryInterviewPageSchema,
  discoveryInterviewProposalSchema,
  submitDiscoveryInterviewAnswerSchema,
} from "@lcsp/contracts/assessment-domain";
import { proxyAssessmentJson } from "@/lib/server/assessment-domain-proxy";

/**
 * Business purpose: Show the owner's pending and reviewed operational answers before an audit scope is chosen.
 * Business rules:
 * - Only strict bounded pagination is forwarded; the API verifies owner and source pins.
 * Execution flow:
 * 1. Normalize the route coordinates and validate an owner-scoped result page.
 * Failure cases:
 * - Invalid identity, pagination and unauthorized access return the canonical problem envelope.
 * Side effects:
 * - Read-only HTTP transport.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await params;
  const query = new URL(request.url).searchParams;
  const offset = query.get("offset") ?? "0";
  const limit = query.get("limit") ?? "50";
  const parsed = discoveryInterviewPageQuerySchema.safeParse({ offset, limit });
  if (!parsed.success) {
    return proxyAssessmentJson(
      request,
      id,
      `/discovery-runs/${encodeURIComponent(runId)}/context-answers?offset=${encodeURIComponent(offset)}&limit=${encodeURIComponent(limit)}`,
      {
        responseSchema: discoveryInterviewPageSchema,
      },
    );
  }
  return proxyAssessmentJson(
    request,
    id,
    `/discovery-runs/${encodeURIComponent(runId)}/context-answers?offset=${parsed.data.offset}&limit=${parsed.data.limit}`,
    { responseSchema: discoveryInterviewPageSchema },
  );
}

/**
 * Business purpose: Submit a customer-authored Discovery question answer for explicit review, not immediate fact acceptance.
 * Business rules:
 * - The exact question, use-case identity and idempotency are validated by the BFF and authoritative API.
 * Execution flow:
 * 1. Validate the request body and forward it under the owner session.
 * Failure cases:
 * - Invalid answers, foreign questions or an active audit reject without new facts.
 * Side effects:
 * - May persist one PENDING_REVIEW proposal and canonical FactNeed.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await params;
  return proxyAssessmentJson(
    request,
    id,
    `/discovery-runs/${encodeURIComponent(runId)}/context-answers`,
    {
      method: "POST",
      bodySchema: submitDiscoveryInterviewAnswerSchema,
      responseSchema: discoveryInterviewProposalSchema,
    },
  );
}
