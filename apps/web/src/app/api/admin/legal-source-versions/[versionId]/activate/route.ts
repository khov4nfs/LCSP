import type { NextRequest } from "next/server";
import { legalSourceVersionDetailSchema } from "@lcsp/contracts/legal-source";

import {
  invalidLegalSourceRouteId,
  parseLegalSourceRouteId,
  proxyLegalSourceJson,
} from "@/lib/server/legal-source-proxy";

type RouteContext = { params: Promise<{ versionId: string }> };

/**
 * Business purpose: Forward activation of one identified Legal Source Version through the
 *   Admin API.
 *
 * Business rules:
 * - The session is required; the API remains authoritative for Admin authorization, ownership
 *   and lifecycle guards.
 * - Validate the version UUID; source readiness, activation eligibility and Preparation
 *   kickoff are API decisions.
 *
 * Execution flow:
 * 1. Resolve and validate the version route parameter.
 * 2. Forward POST activation through the shared session proxy and validate the version-detail
 *   result.
 *
 * Failure cases:
 * - Invalid route identities return the shared 422 problem; session failures, upstream
 *   problems and response-schema failures follow the existing shared proxy policy.
 *
 * Side effects:
 * - One upstream activation request; no local legal-effect judgment or manual lifecycle
 *   write.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { versionId } = await context.params;
  const id = parseLegalSourceRouteId(versionId);
  if (!id) return invalidLegalSourceRouteId();
  return proxyLegalSourceJson(
    request,
    `/admin/legal-source-versions/${id}/activate`,
    { method: "POST", responseSchema: legalSourceVersionDetailSchema },
  );
}
