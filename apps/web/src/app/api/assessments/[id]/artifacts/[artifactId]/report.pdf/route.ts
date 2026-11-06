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
 * Business purpose: Let an authenticated assessment owner download the authorized final-report PDF artifact.
 *
 * Business rules:
 * - Require the normal customer session and valid assessment/artifact UUIDs; upstream API authorization remains authoritative.
 * - Preserve the upstream binary content type, download name, cache restriction, and integrity header.
 *
 * Execution flow:
 * 1. Resolve the customer session and route identifiers.
 * 2. Request the report PDF through the shared authenticated upstream helper.
 * 3. Forward a successful binary response or the shared upstream problem response.
 *
 * Failure cases:
 * - Missing sessions and invalid identifiers return their standard problem responses; upstream authorization or renderer errors are forwarded.
 *
 * Side effects:
 * - Performs a read-only authenticated artifact request; does not create or alter report data.
 */
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
    `/assessments/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifactId)}/report.pdf`,
    { bearerToken: session.token },
  );
  if (!upstream.ok) return upstreamJson(upstream);
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.contentType ?? "application/pdf",
      "content-disposition":
        upstream.contentDisposition ??
        `attachment; filename="assessment-${artifactId}.pdf"`,
      "cache-control": "private, no-store",
      ...(upstream.contentLength
        ? { "content-length": upstream.contentLength }
        : {}),
      ...(upstream.sourceArtifactSha256
        ? { "x-lcsp-source-artifact-sha256": upstream.sourceArtifactSha256 }
        : {}),
    },
  });
}
