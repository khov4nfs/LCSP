import type { NextRequest } from "next/server";
import { requireSessionToken } from "./session-token";
import { upstreamJson, upstreamRequest } from "./upstream-request";

export async function proxyAssessmentRuntimeControl(
  request: NextRequest,
  id: string,
  action: string,
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const mutation = request.method === "POST";
  return upstreamJson(
    await upstreamRequest(
      `/assessments/${encodeURIComponent(id)}/runtime/${action}`,
      {
        method: mutation ? "POST" : "GET",
        bearerToken: session.token,
        ...(mutation
          ? {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(await request.json().catch(() => ({}))),
            }
          : {}),
      },
    ),
  );
}
