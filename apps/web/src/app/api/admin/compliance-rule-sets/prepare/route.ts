import type { NextRequest } from "next/server";
import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  ruleSetPreparationAdminRequestSchema,
  ruleSetPreparationRunSchema,
} from "@lcsp/contracts/compliance-rule-set";
import { requireSessionToken } from "@/lib/server/session-token";
import { problemJson } from "@/lib/server/problem-json";
import {
  upstreamRequest,
  validatedUpstreamJson,
} from "@/lib/server/upstream-request";

/**
 * Business purpose: Request Preparation from the API-resolved legal source without selecting
 *   or inventing source identity in the BFF.
 *
 * Business rules:
 * - The session is required; the API remains authoritative for Admin authorization, ownership
 *   and lifecycle guards.
 * - An empty body remains absent; nonempty JSON must satisfy
 *   ruleSetPreparationAdminRequestSchema.
 *
 * Execution flow:
 * 1. Require the session, parse nonempty JSON and validate the optional request.
 * 2. Forward the validated body when present and validate the returned Preparation run.
 *
 * Failure cases:
 * - Malformed JSON or invalid request data returns submitRequestInvalid with HTTP 422; shared
 *   session/upstream failures are preserved.
 *
 * Side effects:
 * - One upstream Preparation request; source resolution, admission and execution remain
 *   server-owned.
 */
export async function POST(request: NextRequest) {
  const session = requireSessionToken(request);
  if (!session.ok) return session.response;
  const rawBody = await request.text();
  let body: unknown;
  if (rawBody.trim()) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return problemJson(COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid, {
        status: 422,
      });
    }
  }
  const parsedBody = ruleSetPreparationAdminRequestSchema.safeParse(body);
  if (!parsedBody.success)
    return problemJson(COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid, {
      status: 422,
    });
  const upstreamBody = rawBody.trim()
    ? JSON.stringify(parsedBody.data)
    : undefined;
  return validatedUpstreamJson(
    await upstreamRequest("/admin/compliance-rule-sets/prepare", {
      method: "POST",
      ...(upstreamBody
        ? {
            body: upstreamBody,
            headers: { "content-type": "application/json" },
          }
        : {}),
      bearerToken: session.token,
    }),
    (data) => {
      const parsed = ruleSetPreparationRunSchema.safeParse(data);
      return parsed.success ? parsed.data : null;
    },
  );
}
