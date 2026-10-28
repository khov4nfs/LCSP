import type { NextRequest } from "next/server";
import {
  createLegalSourceVersionRequestSchema,
  legalSourceVersionDetailSchema,
} from "@lcsp/contracts/legal-source";

import {
  invalidLegalSourceRouteId,
  parseLegalSourceRouteId,
  proxyLegalSourceJson,
} from "@/lib/server/legal-source-proxy";

type RouteContext = { params: Promise<{ sourceId: string }> };

/**
 * Business purpose: Request a new Legal Source Version for an identified existing source.
 *
 * Business rules:
 * - The session is required; the API remains authoritative for Admin authorization, ownership
 *   and lifecycle guards.
 * - Validate the source UUID and createLegalSourceVersionRequestSchema; the backend
 *   establishes the new version’s lifecycle.
 *
 * Execution flow:
 * 1. Validate the parent source identity.
 * 2. Forward the validated creation request and validate the version-detail response.
 *
 * Failure cases:
 * - Invalid route identities return the shared 422 problem; session failures, upstream
 *   problems and response-schema failures follow the existing shared proxy policy.
 *
 * Side effects:
 * - One upstream version-creation request; no activation is performed by this BFF.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { sourceId } = await context.params;
  const id = parseLegalSourceRouteId(sourceId);
  if (!id) return invalidLegalSourceRouteId();
  return proxyLegalSourceJson(request, `/admin/legal-sources/${id}/versions`, {
    method: "POST",
    bodySchema: createLegalSourceVersionRequestSchema,
    responseSchema: legalSourceVersionDetailSchema,
  });
}
