import type { NextRequest } from "next/server";
import {
  legalPreparationStartRequestSchema,
  legalPreparationRunSchema,
  LEGAL_PORTFOLIO_ERROR_CODES,
} from "@lcsp/contracts/legal-portfolio";
import { requireSessionToken } from "@/lib/server/session-token";
import { problemJson } from "@/lib/server/problem-json";
import {
  upstreamRequest,
  validatedUpstreamJson,
} from "@/lib/server/upstream-request";
export async function POST(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const body = legalPreparationStartRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!body.success)
    return problemJson(LEGAL_PORTFOLIO_ERROR_CODES.submitRequestInvalid, {
      status: 422,
    });
  return validatedUpstreamJson(
    await upstreamRequest("/admin/legal-portfolios/preparations", {
      method: "POST",
      bearerToken: session.token,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body.data),
    }),
    (data) => {
      const parsed = legalPreparationRunSchema.safeParse(data);
      return parsed.success ? parsed.data : null;
    },
  );
}
