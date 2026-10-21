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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const { id } = await params;
  const uuid = claimAssessmentRootRequestSchema.shape.assessmentId;
  if (!uuid.safeParse(id).success) {
    return problemJson(ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID, {
      status: 422,
    });
  }
  const upstream = await upstreamBinaryRequest(
    `/assessments/${encodeURIComponent(id)}/provenance/download`,
    { bearerToken: session.token },
  );
  if (!upstream.ok) return upstreamJson(upstream);
  const responseHeaders = new Headers();
  responseHeaders.set(
    "content-type",
    upstream.contentType ?? "application/json",
  );
  responseHeaders.set(
    "content-disposition",
    upstream.contentDisposition ??
      `attachment; filename="assessment-${id}-provenance.json"`,
  );
  responseHeaders.set("cache-control", "private, no-store");

  const etag = upstream.headers?.get("etag");
  if (etag) {
    responseHeaders.set("etag", etag);
  }
  const checksum = upstream.headers?.get("x-checksum-sha256");
  if (checksum) {
    responseHeaders.set("x-checksum-sha256", checksum);
  }
  const fingerprint = upstream.headers?.get("x-content-fingerprint-sha256");
  if (fingerprint) {
    responseHeaders.set("x-content-fingerprint-sha256", fingerprint);
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
