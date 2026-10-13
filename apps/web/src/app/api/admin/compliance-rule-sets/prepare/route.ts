import type { NextRequest } from "next/server";
import { ruleSetPreparationRunSchema } from "@lcsp/contracts/compliance-rule-set";
import { requireSessionToken } from "@/lib/server/session-token";
import {
  upstreamRequest,
  validatedUpstreamJson,
} from "@/lib/server/upstream-request";

/** Session proxy only: the API resolves source identity and enforces ADMIN authorization. */
export async function POST(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  return validatedUpstreamJson(
    await upstreamRequest("/admin/compliance-rule-sets/prepare", {
      method: "POST",
      bearerToken: session.token,
    }),
    (data) => {
      const parsed = ruleSetPreparationRunSchema.safeParse(data);
      return parsed.success ? parsed.data : null;
    },
  );
}
