import type { NextRequest } from "next/server";
import {
  answerAssessmentHumanRequestSchema,
  answerAssessmentHumanRequestResultSchema,
  claimAssessmentRootRequestSchema,
  ASSESSMENT_DOMAIN_ERROR_CODES,
} from "@lcsp/contracts/assessment-domain";
import { proxyAssessmentJson } from "@/lib/server/assessment-domain-proxy";
import { problemJson } from "@/lib/server/problem-json";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; requestId: string }> },
) {
  const { id, requestId } = await params;
  if (
    !claimAssessmentRootRequestSchema.shape.assessmentId.safeParse(requestId)
      .success
  )
    return problemJson(ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID, {
      status: 422,
    });
  return proxyAssessmentJson(
    request,
    id,
    `/human-requests/${encodeURIComponent(requestId)}/answers`,
    {
      method: "POST",
      bodySchema: answerAssessmentHumanRequestSchema,
      responseSchema: answerAssessmentHumanRequestResultSchema,
    },
  );
}
