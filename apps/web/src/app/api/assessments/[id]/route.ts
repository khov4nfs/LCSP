import type { NextRequest } from "next/server";
import {
  assessmentDetailSchema,
  renameAssessmentSchema,
} from "@lcsp/contracts/assessment-domain";
import { proxyAssessmentJson } from "@/lib/server/assessment-domain-proxy";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, { params }: Context) {
  return proxyAssessmentJson(request, (await params).id, "", {
    responseSchema: assessmentDetailSchema,
  });
}
export async function PATCH(request: NextRequest, { params }: Context) {
  return proxyAssessmentJson(request, (await params).id, "", {
    method: "PATCH",
    bodySchema: renameAssessmentSchema,
  });
}
export async function DELETE(request: NextRequest, { params }: Context) {
  return proxyAssessmentJson(request, (await params).id, "", {
    method: "DELETE",
  });
}
