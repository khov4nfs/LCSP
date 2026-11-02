import { NextResponse, type NextRequest } from "next/server";
import { ASSESSMENT_DOMAIN_ERROR_CODES } from "@lcsp/contracts/assessment-domain";
import { requireSessionToken } from "@/lib/server/session-token";
import { problemJson } from "@/lib/server/problem-json";
import { upstreamBinaryRequest, upstreamJson } from "@/lib/server/upstream-request";
import { z } from "zod";

/**
 * Business purpose: Download the owner's immutable partial selected-rule audit snapshot.
 * Business rules:
 * - Valid UUIDs and session are required; upstream binds export to assessment and request.
 * Execution flow:
 * 1. Check session and route identities. 2. Stream the API's JSON attachment headers and bytes.
 * Failure cases:
 * - Missing session, foreign export or upstream problem never returns a fabricated report.
 * Side effects:
 * - Read-only upstream download sent to the customer's browser.
 */
export async function GET(request: NextRequest,
  { params }: { params: Promise<{ id: string; requestId: string; exportId: string }> }) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const { id, requestId, exportId } = await params;
  if ([id, requestId, exportId].some((value) => !z.uuid().safeParse(value).success))
    return problemJson(ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID, { status: 422 });
  const upstream = await upstreamBinaryRequest(
    `/assessments/${encodeURIComponent(id)}/rule-audits/${encodeURIComponent(requestId)}/exports/${encodeURIComponent(exportId)}/download`,
    { bearerToken: session.token },
  );
  if (!upstream.ok) return upstreamJson(upstream);
  return new NextResponse(upstream.body, { status: upstream.status, headers: {
    "content-type": upstream.contentType ?? "application/json",
    "content-disposition": upstream.contentDisposition ?? `attachment; filename="selected-rule-audit-${exportId}.json"`,
    "cache-control": "private, no-store",
  } });
}
