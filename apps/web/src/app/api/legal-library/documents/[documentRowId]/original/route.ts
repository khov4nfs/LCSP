import type { NextRequest } from "next/server";

import {
  invalidLegalSourceRouteId,
  parseLegalSourceRouteId,
  proxyLegalSourceOriginal,
} from "@/lib/server/legal-source-proxy";

type RouteContext = { params: Promise<{ documentRowId: string }> };

/**
 * Business purpose: Preview the authorized original document from the active legal library.
 *
 * Business rules:
 * - Validate the document UUID and require the shared session guard.
 * - Use the binary proxy’s inline disposition with private, no-store and nosniff handling.
 *
 * Execution flow:
 * 1. Validate the document route identity.
 * 2. Read its original bytes through the shared binary helper and request inline
 *   presentation.
 *
 * Failure cases:
 * - Invalid route identities return the shared 422 problem; session failures, upstream
 *   problems and response-schema failures follow the existing shared proxy policy.
 *
 * Side effects:
 * - One upstream binary read; no document mutation or JSON wrapping.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { documentRowId } = await context.params;
  const document = parseLegalSourceRouteId(documentRowId);
  if (!document) return invalidLegalSourceRouteId();
  return proxyLegalSourceOriginal(
    request,
    `/legal-library/documents/${document}/original`,
    true,
  );
}
