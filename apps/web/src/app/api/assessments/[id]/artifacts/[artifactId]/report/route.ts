import { type NextRequest } from "next/server";
import { SHARED_ERROR_CODES } from "@lcsp/contracts/shared";
import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  claimAssessmentRootRequestSchema,
} from "@lcsp/contracts/assessment-domain";
import { assessmentFinalReportArtifactVersionedSchema } from "@lcsp/contracts/assessment-report";
import { requireSessionToken } from "@/lib/server/session-token";
import { problemJson, successJson } from "@/lib/server/problem-json";
import {
  upstreamBinaryRequest,
  upstreamJson,
} from "@/lib/server/upstream-request";
import { getAuthoritativeRequestLocale } from "@/lib/server/assessment-domain-proxy";

/**
 * Business purpose: Provide the authenticated in-app report view with the immutable final-report artifact in a validated JSON envelope.
 *
 * Business rules:
 * - Require the normal customer session and valid assessment/artifact UUIDs; use the authoritative request locale and upstream owner authorization.
 * - Validate the downloaded artifact against the versioned report contract before returning it to the web client.
 *
 * Execution flow:
 * 1. Resolve the session, identifiers, and authoritative locale.
 * 2. Fetch the report artifact through the shared upstream helper.
 * 3. Parse and validate the JSON, then return a success envelope or standard problem response.
 *
 * Failure cases:
 * - Session and identifier failures return standard problems; upstream problems are forwarded, malformed JSON rejects the request, and schema-invalid JSON returns 502.
 *
 * Side effects:
 * - Performs a read-only authenticated artifact request; no report or assessment state is changed.
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
  const locale = getAuthoritativeRequestLocale(request);
  const upstream = await upstreamBinaryRequest(
    `/assessments/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifactId)}/download`,
    { bearerToken: session.token, locale },
  );
  if (!upstream.ok || !upstream.body) return upstreamJson(upstream);
  const parsed = assessmentFinalReportArtifactVersionedSchema.safeParse(
    JSON.parse(new TextDecoder().decode(upstream.body)),
  );
  return parsed.success
    ? successJson(parsed.data, { status: 200 })
    : problemJson(SHARED_ERROR_CODES.upstreamResponseInvalid, { status: 502 });
}
