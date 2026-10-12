import type { NextRequest } from "next/server";
import {
  createAssessmentSchema,
  assessmentDetailSchema,
  assessmentListSchema,
  assessmentListQuerySchema,
  ASSESSMENT_DOMAIN_ERROR_CODES,
} from "@lcsp/contracts/assessment-domain";
import { requireSessionToken } from "@/lib/server/session-token";
import { problemJson } from "@/lib/server/problem-json";
import {
  upstreamJson,
  upstreamRequest,
  validatedUpstreamJson,
} from "@/lib/server/upstream-request";
import { getAuthoritativeRequestLocale } from "@/lib/server/assessment-domain-proxy";
export async function GET(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const parsed = assessmentListQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success)
    return problemJson(ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID, {
      status: 422,
    });
  const params = new URLSearchParams({
    page: String(parsed.data.page),
    page_size: String(parsed.data.page_size),
    ...(parsed.data.lifecycleState
      ? { lifecycleState: parsed.data.lifecycleState }
      : {}),
  });
  return validatedUpstreamJson(
    await upstreamRequest(`/assessments?${params}`, {
      bearerToken: session.token,
    }),
    (data) => {
      const result = assessmentListSchema.safeParse(data);
      return result.success ? result.data : null;
    },
  );
}
export async function POST(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const parsed = createAssessmentSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return problemJson(ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID, {
      status: 422,
    });
  const locale = getAuthoritativeRequestLocale(request);
  return validatedUpstreamJson(
    await upstreamRequest("/assessments", {
      method: "POST",
      bearerToken: session.token,
      locale,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsed.data),
    }),
    (data) => {
      const result = assessmentDetailSchema.safeParse(data);
      return result.success ? result.data : null;
    },
  );
}
