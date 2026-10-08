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
  { params }: { params: Promise<{ id: string; artifactId: string }> },
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const { id, artifactId } = await params;
  const uuid = claimAssessmentRootRequestSchema.shape.assessmentId;
  if (!uuid.safeParse(id).success || !uuid.safeParse(artifactId).success)
    return problemJson(ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID, {
      status: 422,
    });
  const upstream = await upstreamBinaryRequest(
    `/assessments/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifactId)}/download`,
    { bearerToken: session.token },
  );
  if (!upstream.ok) return upstreamJson(upstream);
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.contentType ?? "application/json",
      "content-disposition":
        upstream.contentDisposition ??
        `attachment; filename="assessment-${artifactId}.json"`,
      "cache-control": "private, no-store",
    },
  });
}
