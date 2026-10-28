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

type RouteContext = { params: Promise<{ documentRowId: string }> };

/**
 * Business purpose: Read the authenticated active-library provisions for an identified legal
 *   document.
 *
 * Business rules:
 * - Validate the document UUID and the shared chunk query/page schemas.
 * - The backend selects the authorized active library; the client cannot replace source pins
 *   through this route.
 *
 * Execution flow:
 * 1. Validate the document route identity.
 * 2. Forward the normalized provision query and validate the chunk page.
 *
 * Failure cases:
 * - Invalid route identities return the shared 422 problem; session failures, upstream
 *   problems and response-schema failures follow the existing shared proxy policy.
 *
 * Side effects:
 * - Read-only upstream library retrieval.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { documentRowId } = await context.params;
  const document = parseLegalSourceRouteId(documentRowId);
  if (!document) return invalidLegalSourceRouteId();
  return proxyLegalSourceJson(
    request,
    `/legal-library/documents/${document}/chunks`,
    {
      querySchema: legalSourceChunkQuerySchema,
      responseSchema: legalSourceChunkPageSchema,
    },
  );
}
