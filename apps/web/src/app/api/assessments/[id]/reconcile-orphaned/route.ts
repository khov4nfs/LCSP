import { reconcileOrphanedAssessmentResultSchema } from "@lcsp/contracts/assessment-domain";
import type { NextRequest } from "next/server";

import { proxyAssessmentJson } from "@/lib/server/assessment-domain-proxy";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return proxyAssessmentJson(
    request,
    (await params).id,
    "/reconcile-orphaned",
    {
      method: "POST",
      responseSchema: reconcileOrphanedAssessmentResultSchema,
    },
  );
}
