import type { NextRequest } from "next/server";
import { completeAssessmentRepositorySetupResultSchema } from "@lcsp/contracts/assessment-domain";
import { proxyAssessmentJson } from "@/lib/server/assessment-domain-proxy";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return proxyAssessmentJson(
    request,
    (await params).id,
    "/repository-setup/complete",
    {
      method: "POST",
      responseSchema: completeAssessmentRepositorySetupResultSchema,
    },
  );
}
