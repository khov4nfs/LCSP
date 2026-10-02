import type { NextRequest } from "next/server";

import { sanitizeAssessmentInterviewSourceSnippet } from "@/lib/api/assessment-interview-client";
import { requireSessionToken } from "@/lib/server/session-token";
import {
  upstreamRequest,
  validatedUpstreamJson,
} from "@/lib/server/upstream-request";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; questionId: string }> },
) {
  const session = requireSessionToken(request);
  if (!session.ok) {
    return session.response;
  }
  const { id, questionId } = await params;
  const upstream = await upstreamRequest(
    `/assessments/${encodeURIComponent(id)}/interview/questions/${encodeURIComponent(questionId)}/source-snippet`,
    { bearerToken: session.token },
  );
  return validatedUpstreamJson(
    upstream,
    sanitizeAssessmentInterviewSourceSnippet,
  );
}
