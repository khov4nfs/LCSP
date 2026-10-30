import type { NextRequest } from "next/server";
import { ruleAuditExportMetadataSchema, ruleAuditExportRequestSchema } from "@lcsp/contracts/assessment-domain";
import { proxyAssessmentJson } from "@/lib/server/assessment-domain-proxy";

/**
 * Business purpose: Create a labelled snapshot of only currently accepted selected-rule results.
 * Business rules:
 * - The upstream API checks ownership, evidence and idempotency before exporting.
 * Execution flow:
 * 1. Resolve request ID. 2. Validate export key and proxy the metadata envelope.
 * Failure cases:
 * - Empty or invalidated results return a problem, never a full report.
 * Side effects:
 * - Forwards one partial export creation command to the assessment API.
 */
export async function POST(request: NextRequest,
  { params }: { params: Promise<{ id: string; requestId: string }> }) {
  const { id, requestId } = await params;
  return proxyAssessmentJson(request, id, `/rule-audits/${encodeURIComponent(requestId)}/exports`, {
    method: "POST", bodySchema: ruleAuditExportRequestSchema,
    responseSchema: ruleAuditExportMetadataSchema,
  });
}
