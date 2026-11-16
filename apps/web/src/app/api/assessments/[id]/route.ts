import type { NextRequest } from "next/server";
import {
  assessmentDetailSchema,
  renameAssessmentSchema,
} from "@lcsp/contracts/assessment-domain";
import { proxyAssessmentJson } from "@/lib/server/assessment-domain-proxy";

type Context = { params: Promise<{ id: string }> };
/**
 * Business purpose: Open an owned assessment while a translation is awaiting review.
 * Business rules:
 * - The shared proxy authorizes access and marks a pending-translation fallback.
 * Execution flow:
 * 1. Forward the assessment detail read through the validated proxy.
 * Failure cases:
 * - Authorization, integrity and upstream failures propagate as problems.
 * Side effects:
 * - Reads assessment data; does not change canonical content.
 */
export async function GET(request: NextRequest, { params }: Context) {
  return proxyAssessmentJson(request, (await params).id, "", {
    responseSchema: assessmentDetailSchema,
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
