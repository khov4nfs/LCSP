import type { NextRequest } from "next/server";
import { ruleAuditRequestViewSchema, submitRuleAuditSchema } from "@lcsp/contracts/assessment-domain";
import { proxyAssessmentJson } from "@/lib/server/assessment-domain-proxy";

/**
 * Business purpose: Carry an explicit selected-rule audit command from the customer session.
 * Business rules:
 * - Validate exact pins, rule identities and idempotency before forwarding to the owner API.
 * Execution flow:
 * 1. Resolve assessment route identity. 2. Proxy the validated JSON command and response.
 * Failure cases:
 * - Invalid payload, session or server rejection becomes a shared problem response.
 * Side effects:
 * - Forwards one audit request; the API alone freezes scope and dispatches Root.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return proxyAssessmentJson(request, (await params).id, "/rule-audits", {
    method: "POST", bodySchema: submitRuleAuditSchema, responseSchema: ruleAuditRequestViewSchema,
  });
}
