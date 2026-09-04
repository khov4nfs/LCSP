import type { NextRequest } from "next/server";

import { requireSessionToken } from "@/lib/server/session-token";
import {
  upstreamJson,
  upstreamRequest,
  validatedUpstreamJson,
} from "@/lib/server/upstream-request";
import { sanitizeAssessmentInterviewState } from "@/lib/api/assessment-interview-client";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = requireSessionToken(request);
  if (!session.ok) {
    return session.response;
  }
  const { id } = await params;
  const upstream = await upstreamRequest(
    `/assessments/${encodeURIComponent(id)}/interview`,
    { bearerToken: session.token },
  );
  return validatedUpstreamJson(upstream, sanitizeAssessmentInterviewState);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = requireSessionToken(request);
  if (!session.ok) {
    return session.response;
  }
  const { id } = await params;
  const upstream = await upstreamRequest(
    `/assessments/${encodeURIComponent(id)}/interview/answers`,
    {
      method: "POST",
      bearerToken: session.token,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(await request.json().catch(() => null)),
    },
  );
  return upstream.ok
    ? validatedUpstreamJson(upstream, sanitizeAssessmentInterviewState)
    : upstreamJson(upstream);
}
