import type { NextRequest } from "next/server";
import {
  assessmentDiscoveryRunViewSchema,
  startAssessmentDiscoveryRunSchema,
} from "@lcsp/contracts/assessment-domain";
import { proxyAssessmentJson } from "@/lib/server/assessment-domain-proxy";

/**
 * Business purpose: Start an explicitly authorized pre-audit discovery from the customer session.
 * Business rules:
 * - The BFF validates idempotency and authenticated session; the API alone authorizes source pins and run creation.
 * Execution flow:
 * 1. Resolve the assessment route and forward a strict start request.
 * Failure cases:
 * - Invalid session, body, or API rejection returns the standard problem envelope.
 * Side effects:
 * - May enqueue one deterministic scan, never an audit decision.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return proxyAssessmentJson(request, (await params).id, "/discovery-runs", {
    method: "POST",
    bodySchema: startAssessmentDiscoveryRunSchema,
    responseSchema: assessmentDiscoveryRunViewSchema,
  });
}
