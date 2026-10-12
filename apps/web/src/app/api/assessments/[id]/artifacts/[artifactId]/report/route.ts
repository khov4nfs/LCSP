import { type NextRequest } from "next/server";
import { SHARED_ERROR_CODES } from "@lcsp/contracts/shared";
import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  assessmentFinalReportArtifactSchema,
  claimAssessmentRootRequestSchema,
} from "@lcsp/contracts/assessment-domain";
import { requireSessionToken } from "@/lib/server/session-token";
import { problemJson, successJson } from "@/lib/server/problem-json";
import {
  upstreamBinaryRequest,
  upstreamJson,
} from "@/lib/server/upstream-request";

/** The stored report artifact as a validated JSON envelope, for the in-app report view. */
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
  if (!upstream.ok || !upstream.body) return upstreamJson(upstream);
  const parsed = assessmentFinalReportArtifactSchema.safeParse(
    JSON.parse(new TextDecoder().decode(upstream.body)),
  );
  return parsed.success
    ? successJson(parsed.data, { status: 200 })
    : problemJson(SHARED_ERROR_CODES.upstreamResponseInvalid, { status: 502 });
}
