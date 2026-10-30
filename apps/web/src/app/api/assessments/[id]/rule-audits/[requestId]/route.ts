import type { NextRequest } from "next/server";
import { ruleAuditRequestViewSchema } from "@lcsp/contracts/assessment-domain";
import { proxyAssessmentJson } from "@/lib/server/assessment-domain-proxy";

/**
 * Business purpose: Restore one immutable audit request's current per-rule progress after reload.
 * Business rules:
 * - Request and assessment IDs stay bound to the authenticated upstream owner check.
 * Execution flow:
 * 1. Resolve route IDs. 2. Proxy and validate the canonical request projection.
 * Failure cases:
 * - Foreign, missing or malformed requests return the upstream problem envelope.
 * Side effects:
 * - Read-only upstream request.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; requestId: string }> }) {
  const { id, requestId } = await params;
  return proxyAssessmentJson(request, id, `/rule-audits/${encodeURIComponent(requestId)}`, {
    responseSchema: ruleAuditRequestViewSchema,
  });
}
