import type { NextRequest } from "next/server";
import { complianceRuleSetHistorySchema } from "@lcsp/contracts/compliance-rule-set";
import { requireSessionToken } from "@/lib/server/session-token";
import {
  upstreamRequest,
  validatedUpstreamJson,
} from "@/lib/server/upstream-request";
export async function GET(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  return validatedUpstreamJson(
    await upstreamRequest("/admin/compliance-rule-sets", {
      bearerToken: session.token,
    }),
    (data) => {
      const parsed = complianceRuleSetHistorySchema.safeParse(data);
      return parsed.success ? parsed.data : null;
    },
  );
}
