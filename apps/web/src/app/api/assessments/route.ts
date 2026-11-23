import type { NextRequest } from "next/server";
import {
  createAssessmentSchema,
  assessmentDetailSchema,
  assessmentListQuerySchema,
  assessmentReadListSchema,
  ASSESSMENT_DOMAIN_ERROR_CODES,
} from "@lcsp/contracts/assessment-domain";
import { requireSessionToken } from "@/lib/server/session-token";
import { problemJson } from "@/lib/server/problem-json";
import {
  upstreamRequest,
  validatedUpstreamJson,
} from "@/lib/server/upstream-request";
import { getAuthoritativeRequestLocale } from "@/lib/server/assessment-domain-proxy";

/**
 * Business purpose:
 * Proxies a paginated assessment read using the projection selected by backend RBAC.
 *
 * Business rules:
 * - CUSTOMER responses may contain owned assessment summaries; ADMIN responses must match
 *   the strict operational-metadata list contract. The BFF never broadens either projection.
 *
 * Execution flow:
 * 1. Require the authenticated session and validate pagination/filter inputs.
 * 2. Forward the normalized query to the NestJS API.
 * 3. Validate the returned CUSTOMER-or-ADMIN read union before forwarding JSON.
 *
 * Failure cases:
 * - Invalid inputs return the standard request problem; invalid upstream payloads are rejected
 *   by the shared validated-upstream response path.
 *
 * Side effects:
 * - Performs one read-only upstream request; no assessment state is changed.
 */
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
      // The union contains two strict member schemas, so accepting ADMIN metadata
      // does not permit extra customer-content fields to leak into that projection.
      const result = assessmentReadListSchema.safeParse(data);
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
