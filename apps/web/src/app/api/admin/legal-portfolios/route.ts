import type { NextRequest } from "next/server";
import { legalPortfolioHistorySchema } from "@lcsp/contracts/legal-portfolio";
import { requireSessionToken } from "@/lib/server/session-token";
import {
  upstreamRequest,
  validatedUpstreamJson,
} from "@/lib/server/upstream-request";
export async function GET(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  return validatedUpstreamJson(
    await upstreamRequest("/admin/legal-portfolios", {
      bearerToken: session.token,
    }),
    (data) => {
      const parsed = legalPortfolioHistorySchema.safeParse(data);
      return parsed.success ? parsed.data : null;
    },
  );
}
