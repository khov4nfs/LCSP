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

/**
 * Business purpose: Return an Admin’s requested immutable Rule Set result through the
 *   authenticated BFF.
 *
 * Business rules:
 * - The session is required; the API remains authoritative for Admin authorization, ownership
 *   and lifecycle guards.
 * - Accept only a UUID Rule Set identity and validate success against
 *   complianceRuleSetResultSchema.
 *
 * Execution flow:
 * 1. Require the session, validate the route identity and request the matching Admin result.
 * 2. Validate the response and forward the shared result envelope.
 *
 * Failure cases:
 * - Invalid route identities return the shared 422 problem; session failures, upstream
 *   problems and response-schema failures follow the existing shared proxy policy.
 *
 * Side effects:
 * - One upstream read; no Rule Set or Preparation state is changed.
 */
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
