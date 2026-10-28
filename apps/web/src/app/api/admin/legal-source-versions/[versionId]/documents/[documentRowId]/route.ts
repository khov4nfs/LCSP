import type { NextRequest } from "next/server";

import {
  invalidLegalSourceRouteId,
  parseLegalSourceRouteId,
  proxyLegalSourceDelete,
} from "@/lib/server/legal-source-proxy";

type RouteContext = {
  params: Promise<{ versionId: string; documentRowId: string }>;
};

/**
 * Business purpose: Forward removal of an identified document through the backend’s guarded
 *   Legal Source lifecycle.
 *
 * Business rules:
 * - The session is required; the API remains authoritative for Admin authorization, ownership
 *   and lifecycle guards.
 * - Validate both version/document UUIDs; backend rules govern deletion eligibility.
 *
 * Execution flow:
 * 1. Validate the route identities.
 * 2. Forward DELETE and preserve the shared empty-success or problem response.
 *
 * Failure cases:
 * - Invalid route identities return the shared 422 problem; session failures, upstream
 *   problems and response-schema failures follow the existing shared proxy policy.
 *
 * Side effects:
 * - One upstream document-deletion request; no direct storage or graph deletion in the BFF.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const { versionId, documentRowId } = await context.params;
  const version = parseLegalSourceRouteId(versionId);
  const document = parseLegalSourceRouteId(documentRowId);
  if (!version || !document) return invalidLegalSourceRouteId();
  return proxyLegalSourceDelete(
    request,
    `/admin/legal-source-versions/${version}/documents/${document}`,
  );
}
