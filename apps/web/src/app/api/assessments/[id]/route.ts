import type { NextRequest } from "next/server";
import {
  assessmentReadDetailSchema,
  renameAssessmentSchema,
} from "@lcsp/contracts/assessment-domain";
import { proxyAssessmentJson } from "@/lib/server/assessment-domain-proxy";

type Context = { params: Promise<{ id: string }> };
/**
 * Business purpose: Open the assessment projection authorized for the caller's RBAC role.
 * Business rules:
 * - CUSTOMER receives owned assessment content; ADMIN receives only strict operational metadata.
 * - The shared proxy authorizes access and marks a pending-translation fallback when applicable.
 * Execution flow:
 * 1. Forward the assessment detail read through the validated proxy.
 * Failure cases:
 * - Authorization, integrity and upstream failures propagate as problems.
 * Side effects:
 * - Reads assessment data; does not change canonical content.
 */
export async function GET(request: NextRequest, { params }: Context) {
  return proxyAssessmentJson(request, (await params).id, "", {
    // The strict union preserves the backend role boundary without teaching the BFF
    // to infer roles or transform sensitive customer content itself.
    responseSchema: assessmentReadDetailSchema,
    allowPendingLocalizationFallback: true,
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
