import type { NextRequest } from "next/server";
import { assessmentHumanRequestsResultSchema } from "@lcsp/contracts/assessment-domain";
import { proxyAssessmentJson } from "@/lib/server/assessment-domain-proxy";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return proxyAssessmentJson(request, (await params).id, "/human-requests", {
    responseSchema: assessmentHumanRequestsResultSchema,
  });
}
