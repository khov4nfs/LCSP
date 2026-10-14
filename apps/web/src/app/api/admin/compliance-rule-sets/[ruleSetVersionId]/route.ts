import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  complianceRuleSetResultSchema,
} from "@lcsp/contracts/compliance-rule-set";
import { requireSessionToken } from "@/lib/server/session-token";
import { problemJson } from "@/lib/server/problem-json";
import {
  upstreamRequest,
  validatedUpstreamJson,
} from "@/lib/server/upstream-request";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ ruleSetVersionId: string }> },
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const { ruleSetVersionId } = await context.params;
  const id = z.uuid().safeParse(ruleSetVersionId);
  if (!id.success)
    return problemJson(COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid, {
      status: 422,
    });
  return validatedUpstreamJson(
    await upstreamRequest(`/admin/compliance-rule-sets/${id.data}`, {
      bearerToken: session.token,
    }),
    (data) => {
      const parsed = complianceRuleSetResultSchema.safeParse(data);
      return parsed.success ? parsed.data : null;
    },
  );
}
