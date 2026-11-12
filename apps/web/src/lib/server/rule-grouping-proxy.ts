import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  ruleGroupingProposalSchema,
  ruleCatalogLedgerSchema,
  submitRuleCatalogGroupsSchema,
  approveRuleCatalogGroupsSchema,
  RULE_CATALOG_REVIEW_STATES,
  pendingRuleGroupingSchema,
} from "@lcsp/contracts/assessment-domain";
import { COMPLIANCE_RULE_SET_ERROR_CODES } from "@lcsp/contracts/compliance-rule-set";
import { requireSessionToken } from "./session-token";
import { upstreamRequest, validatedUpstreamJson } from "./upstream-request";
import { problemJson } from "./problem-json";

/**
 * Business purpose: Expose the bounded Admin list of versions awaiting grouping review.
 * Business rules:
 * - Session credentials are forwarded through shared upstream transport; API Admin authorization remains mandatory.
 * Execution flow:
 * 1. Require the session, read pending versions and validate the public response schema.
 * Failure cases:
 * - Missing sessions and invalid/unauthorized upstream responses return shared problems.
 * Side effects:
 * - Performs one read without generating or approving memberships.
 */
export async function proxyPendingRuleGroupings(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  return validatedUpstreamJson(
    await upstreamRequest("/admin/compliance-rule-sets/groups/pending", {
      bearerToken: session.token,
    }),
    (data) => {
      const parsed = pendingRuleGroupingSchema.safeParse(data);
      return parsed.success ? parsed.data : null;
    },
  );
}

/**
 * Business purpose: Forward the authenticated Admin grouping review workflow through validated API contracts.
 * Business rules:
 * - Only known paths/methods and version UUIDs pass; backend Admin and two-person gates remain authoritative.
 * Execution flow:
 * 1. Validate session/path/body, forward the exact action and validate the returned public schema.
 * Failure cases:
 * - Invalid actions, malformed bodies and upstream authorization or governance errors remain explicit failures.
 * Side effects:
 * - Performs one scoped upstream review read, submission or approval.
 */
export async function proxyRuleGrouping(
  request: NextRequest,
  context: { params: Promise<{ ruleSetVersionId: string; action?: string[] }> },
) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const { ruleSetVersionId, action = [] } = await context.params;
  const suffix = action.join("/");
  if (
    !z.uuid().safeParse(ruleSetVersionId).success ||
    action.length > 1 ||
    !(request.method === "GET"
      ? ["", "proposal"].includes(suffix)
      : request.method === "POST" && ["", "approval"].includes(suffix))
  )
    return problemJson(COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid, {
      status: 422,
    });
  let body: string | undefined;
  if (request.method === "POST") {
    const parsed = (
      suffix === "approval"
        ? approveRuleCatalogGroupsSchema
        : submitRuleCatalogGroupsSchema
    ).safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return problemJson(COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid, {
        status: 422,
      });
    body = JSON.stringify(parsed.data);
  }
  const schema =
    request.method === "GET"
      ? suffix === "proposal"
        ? ruleGroupingProposalSchema
        : ruleCatalogLedgerSchema
      : suffix === "approval"
        ? z.object({ state: z.literal(RULE_CATALOG_REVIEW_STATES.APPROVED) })
        : ruleCatalogLedgerSchema;
  return validatedUpstreamJson(
    await upstreamRequest(
      `/admin/compliance-rule-sets/${ruleSetVersionId}/groups${suffix ? `/${suffix}` : ""}`,
      {
        bearerToken: session.token,
        method: request.method,
        ...(body
          ? { body, headers: { "content-type": "application/json" } }
          : {}),
      },
    ),
    (data) => {
      const parsed = schema.safeParse(data);
      return parsed.success ? parsed.data : null;
    },
  );
}
