import { NextRequest } from "next/server";

import { sanitizeAssessmentDetailPayload } from "@/lib/api/classification-client";
import { mockJsonResponse } from "@/lib/server/fixtures/response";
import { requireSessionToken } from "@/lib/server/session-token";
import {
  upstreamJson,
  upstreamRequest,
  validatedUpstreamJson,
} from "@/lib/server/upstream-request";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const mock = await mockJsonResponse("assessment-detail.json");
  if (mock) return mock;
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  const { id } = await params;
  const upstream = await upstreamRequest(
    `/assessments/${encodeURIComponent(id)}`,
    { bearerToken: session.token },
  );

  return validatedUpstreamJson(upstream, sanitizeAssessmentDetailPayload);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  const { id } = await params;
  const upstream = await upstreamRequest(
    `/assessments/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      bearerToken: session.token,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(await request.json().catch(() => null)),
    },
  );
  return upstreamJson(upstream);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;

  const { id } = await params;
  const upstream = await upstreamRequest(
    `/assessments/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      bearerToken: session.token,
    },
  );
  return upstreamJson(upstream);
}
