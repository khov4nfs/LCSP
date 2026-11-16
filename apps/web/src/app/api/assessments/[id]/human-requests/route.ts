import type { NextRequest } from "next/server";
import { assessmentHumanRequestsResultSchema } from "@lcsp/contracts/assessment-domain";
import { proxyAssessmentJson } from "@/lib/server/assessment-domain-proxy";

/**
 * Business purpose: Show the owner's assessment questions while translation is pending.
 * Business rules:
 * - The shared proxy authorizes access and identifies canonical-content fallback.
 * Execution flow:
 * 1. Forward the human-request read through the validated proxy.
 * Failure cases:
 * - Authorization, integrity and upstream failures propagate as problems.
 * Side effects:
 * - Reads questions without modifying answers or canonical content.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return proxyAssessmentJson(request, (await params).id, "/human-requests", {
    responseSchema: assessmentHumanRequestsResultSchema,
    allowPendingLocalizationFallback: true,
  });
}
