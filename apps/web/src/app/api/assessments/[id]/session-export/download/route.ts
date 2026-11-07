import { NextResponse, type NextRequest } from "next/server";
import {
  claimAssessmentRootRequestSchema,
  ASSESSMENT_DOMAIN_ERROR_CODES,
} from "@lcsp/contracts/assessment-domain";
import { requireSessionToken } from "@/lib/server/session-token";
import { problemJson } from "@/lib/server/problem-json";
import {
  upstreamBinaryRequest,
  upstreamJson,
} from "@/lib/server/upstream-request";

/**
 * Business purpose: Relay a customer-owned session JSON export to the browser.
 * Business rules:
 * - Only authenticated sessions and valid assessment IDs are eligible.
 * - The upstream API is the authoritative ownership, pinned-source and evidence-integrity gate.
 * Execution flow:
 * 1. Validate the session and assessment identity.
 * 2. Request the protected upstream attachment.
 * 3. Forward its exact bytes and checksum headers without caching.
 * Failure cases:
 * - Missing authorization or invalid IDs return the shared problem response before any upstream request.
 * - Upstream errors are relayed without generating a partial download.
 * Side effects:
 * - Read-only local proxy; the upstream endpoint records the authorized export audit.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const { id } = await params;
  if (
    !claimAssessmentRootRequestSchema.shape.assessmentId.safeParse(id).success
  )
    return problemJson(ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID, {
      status: 422,
    });
  const upstream = await upstreamBinaryRequest(
    "/assessments/" + encodeURIComponent(id) + "/session-export/download",
    { bearerToken: session.token },
  );
  if (!upstream.ok) return upstreamJson(upstream);
  const headers = new Headers({
    "content-type": upstream.contentType ?? "application/json",
    "content-disposition":
      upstream.contentDisposition ??
      'attachment; filename="assessment-' + id + '-session.json"',
    "cache-control": "private, no-store",
  });
  for (const name of [
    "etag",
    "x-checksum-sha256",
    "x-content-fingerprint-sha256",
  ]) {
    const value = upstream.headers?.get(name);
    if (value) headers.set(name, value);
  }
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers,
  });
}
