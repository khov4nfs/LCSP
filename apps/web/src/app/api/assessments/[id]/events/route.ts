import type { NextRequest } from "next/server";
import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  assessmentEventsPageSchema,
  assessmentEventsQuerySchema,
} from "@lcsp/contracts/assessment-domain";
import { problemJson } from "@/lib/server/problem-json";
import { proxyAssessmentJson } from "@/lib/server/assessment-domain-proxy";

/** The conversation's canonical events, paged by sequence. Transport and session only. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const page = assessmentEventsQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!page.success)
    return problemJson(ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID, {
      status: 422,
    });
  const query = new URLSearchParams({
    afterSequence: String(page.data.afterSequence),
    limit: String(page.data.limit),
  });
  return proxyAssessmentJson(
    request,
    (await params).id,
    `/events?${query.toString()}`,
    { responseSchema: assessmentEventsPageSchema },
  );
}
