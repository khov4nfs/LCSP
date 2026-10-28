import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  ruleSetPreparationRunSchema,
} from "@lcsp/contracts/compliance-rule-set";
import { requireSessionToken } from "@/lib/server/session-token";
import { problemJson } from "@/lib/server/problem-json";
import {
  upstreamRequest,
  validatedUpstreamJson,
} from "@/lib/server/upstream-request";

/**
 * Business purpose: Forward an Admin request to resume the identified existing Rule Set
 *   Preparation.
 *
 * Business rules:
 * - The session is required; the API remains authoritative for Admin authorization, ownership
 *   and lifecycle guards.
 * - Validate the Preparation UUID and return only a ruleSetPreparationRunSchema-compatible
 *   result.
 *
 * Execution flow:
 * 1. Require the session and validate the existing run identity.
 * 2. POST to that run’s resume endpoint and validate the returned run.
 *
 * Failure cases:
 * - Invalid route identities return the shared 422 problem; session failures, upstream
 *   problems and response-schema failures follow the existing shared proxy policy.
 *
 * Side effects:
 * - One upstream resume request; the API and native runtime own continuation and durable
 *   state.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ preparationRunId: string }> },
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const id = z.uuid().safeParse((await context.params).preparationRunId);
  if (!id.success)
    return problemJson(COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid, {
      status: 422,
    });
  return validatedUpstreamJson(
    await upstreamRequest(
      `/admin/compliance-rule-sets/preparations/${id.data}/resume`,
      { method: "POST", bearerToken: session.token },
    ),
    (data) => {
      const parsed = ruleSetPreparationRunSchema.safeParse(data);
      return parsed.success ? parsed.data : null;
    },
  );
}
