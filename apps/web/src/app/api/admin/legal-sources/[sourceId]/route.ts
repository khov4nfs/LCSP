import type { NextRequest } from "next/server";
import {
  legalSourceDetailSchema,
  updateLegalSourceRequestSchema,
} from "@lcsp/contracts/legal-source";

import {
  invalidLegalSourceRouteId,
  parseLegalSourceRouteId,
  proxyLegalSourceJson,
} from "@/lib/server/legal-source-proxy";

type RouteContext = { params: Promise<{ sourceId: string }> };

/**
 * Business purpose: Read an Admin’s identified legal-source definition and version summary.
 *
 * Business rules:
 * - The session is required; the API remains authoritative for Admin authorization, ownership
 *   and lifecycle guards.
 * - Validate the source UUID and legalSourceDetailSchema result.
 *
 * Execution flow:
 * 1. Validate the source identity.
 * 2. Forward the detail read and validate the shared response.
 *
 * Failure cases:
 * - Invalid route identities return the shared 422 problem; session failures, upstream
 *   problems and response-schema failures follow the existing shared proxy policy.
 *
 * Side effects:
 * - One upstream read; no source metadata changes.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { sourceId } = await context.params;
  const id = parseLegalSourceRouteId(sourceId);
  if (!id) return invalidLegalSourceRouteId();
  return proxyLegalSourceJson(request, `/admin/legal-sources/${id}`, {
    responseSchema: legalSourceDetailSchema,
  });
}

/**
 * Business purpose: Forward an Admin’s legal-source metadata update without duplicating
 *   backend business rules.
 *
 * Business rules:
 * - The session is required; the API remains authoritative for Admin authorization, ownership
 *   and lifecycle guards.
 * - Validate the source UUID and updateLegalSourceRequestSchema; validate the returned source
 *   detail.
 *
 * Execution flow:
 * 1. Validate the source identity.
 * 2. Validate and forward PATCH metadata through the shared proxy.
 *
 * Failure cases:
 * - Invalid route identities return the shared 422 problem; session failures, upstream
 *   problems and response-schema failures follow the existing shared proxy policy.
 *
 * Side effects:
 * - One upstream source-metadata mutation.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { sourceId } = await context.params;
  const id = parseLegalSourceRouteId(sourceId);
  if (!id) return invalidLegalSourceRouteId();
  return proxyLegalSourceJson(request, `/admin/legal-sources/${id}`, {
    method: "PATCH",
    bodySchema: updateLegalSourceRequestSchema,
    responseSchema: legalSourceDetailSchema,
  });
}
