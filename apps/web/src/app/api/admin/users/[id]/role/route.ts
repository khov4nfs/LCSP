import { NextRequest } from "next/server";
import { AUTH_ERROR_CODES, AUTH_USER_ROLES } from "@lcsp/contracts/auth";

import { problemJson } from "@/lib/server/problem-json";
import { requireSessionToken } from "@/lib/server/session-token";
import { upstreamJson, upstreamRequest } from "@/lib/server/upstream-request";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = requireSessionToken(request);
  if (!session.ok) {
    return session.response;
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    role?: string;
  } | null;

  if (
    !body ||
    !body.role ||
    !Object.values(AUTH_USER_ROLES).includes(body.role as never)
  ) {
    return problemJson(AUTH_ERROR_CODES.validationFailed, { status: 400 });
  }

  const upstream = await upstreamRequest(`/admin/users/${id}/role`, {
    method: "POST",
    bearerToken: session.token,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: body.role }),
  });

  return upstreamJson(upstream);
}
