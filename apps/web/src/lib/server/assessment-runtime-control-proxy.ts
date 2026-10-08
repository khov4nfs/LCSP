import type { NextRequest } from "next/server";
import {
  assessmentRuntimeControlRequestSchema,
  assessmentRuntimeControlResultSchema,
} from "@lcsp/contracts/evidence";
import { proxyAssessmentJson } from "./assessment-domain-proxy";
export async function proxyAssessmentRuntimeControl(
  request: NextRequest,
  id: string,
  action: string,
) {
  return proxyAssessmentJson(request, id, `/runtime/${action}`, {
    method: request.method,
    ...(request.method === "POST"
      ? { bodySchema: assessmentRuntimeControlRequestSchema }
      : {}),
    responseSchema: assessmentRuntimeControlResultSchema.nullable(),
  });
}
