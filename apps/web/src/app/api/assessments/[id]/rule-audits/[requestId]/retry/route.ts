import type { NextRequest } from "next/server";
import { ruleAuditRequestViewSchema, ruleAuditRetryRequestSchema } from "@lcsp/contracts/assessment-domain";
import { proxyAssessmentJson } from "@/lib/server/assessment-domain-proxy";

/**
 * Business purpose: Retry the same frozen failed audit from an authenticated customer session.
 * Business rules:
 * - The upstream API verifies owner, failure state and retry idempotency.
 * Execution flow:
 * 1. Resolve request identity. 2. Validate retry body and forward the command.
 * Failure cases:
 * - Invalid or stale requests return shared problem responses without new scope.
 * Side effects:
 * - Forwards one retry; API outbox owns any Root dispatch.
 */
export async function POST(request: NextRequest,
  { params }: { params: Promise<{ id: string; requestId: string }> }) {
  const { id, requestId } = await params;
  return proxyAssessmentJson(request, id, `/rule-audits/${encodeURIComponent(requestId)}/retry`, {
    method: "POST", bodySchema: ruleAuditRetryRequestSchema,
    responseSchema: ruleAuditRequestViewSchema,
  });
}
