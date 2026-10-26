import type { NextRequest } from "next/server";
import { z } from "zod";
import { COMPLIANCE_RULE_SET_ERROR_CODES, ruleSetPreparationRunSchema } from "@lcsp/contracts/compliance-rule-set";
import { requireSessionToken } from "@/lib/server/session-token";
import { problemJson } from "@/lib/server/problem-json";
import { upstreamRequest, validatedUpstreamJson } from "@/lib/server/upstream-request";

export async function POST(request: NextRequest, context: { params: Promise<{ preparationRunId: string }> }) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const id = z.uuid().safeParse((await context.params).preparationRunId);
  if (!id.success) return problemJson(COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid, { status: 422 });
  return validatedUpstreamJson(await upstreamRequest(`/admin/compliance-rule-sets/preparations/${id.data}/resume`, { method: "POST", bearerToken: session.token }), (data) => {
    const parsed = ruleSetPreparationRunSchema.safeParse(data);
    return parsed.success ? parsed.data : null;
  });
}
