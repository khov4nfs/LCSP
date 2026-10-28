import type { NextRequest } from "next/server";
import {
  legalSourceChunkPageSchema,
  legalSourceChunkQuerySchema,
} from "@lcsp/contracts/legal-source";

import {
  invalidLegalSourceRouteId,
  parseLegalSourceRouteId,
  proxyLegalSourceJson,
} from "@/lib/server/legal-source-proxy";

type RouteContext = {
  params: Promise<{ versionId: string; documentRowId: string }>;
};

/**
 * Business purpose: Read a paginated provision view for an Admin’s identified
 *   version/document pair.
 *
 * Business rules:
 * - The session is required; the API remains authoritative for Admin authorization, ownership
 *   and lifecycle guards.
 * - Both route identities must be UUIDs; chunk query and response use the shared
 *   pagination/provision schemas.
 *
 * Execution flow:
 * 1. Validate the version and document identities.
 * 2. Forward the normalized chunk query and validate legalSourceChunkPageSchema.
 *
 * Failure cases:
 * - Invalid route identities return the shared 422 problem; session failures, upstream
 *   problems and response-schema failures follow the existing shared proxy policy.
 *
 * Side effects:
 * - Read-only upstream provision retrieval.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { versionId, documentRowId } = await context.params;
  const version = parseLegalSourceRouteId(versionId);
  const document = parseLegalSourceRouteId(documentRowId);
  if (!version || !document) return invalidLegalSourceRouteId();
  return proxyLegalSourceJson(
    request,
    `/admin/legal-source-versions/${version}/documents/${document}/chunks`,
    {
      querySchema: legalSourceChunkQuerySchema,
      responseSchema: legalSourceChunkPageSchema,
    },
  );
}
