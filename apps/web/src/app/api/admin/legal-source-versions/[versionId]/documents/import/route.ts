import type { NextRequest } from "next/server";
import {
  importLegalSourceDocumentRequestSchema,
  legalSourceDocumentViewSchema,
} from "@lcsp/contracts/legal-source";

import {
  invalidLegalSourceRouteId,
  parseLegalSourceRouteId,
  proxyLegalSourceJson,
} from "@/lib/server/legal-source-proxy";

type RouteContext = { params: Promise<{ versionId: string }> };

/**
 * Business purpose: Request managed URL ingestion of a legal document into an identified
 *   source version.
 *
 * Business rules:
 * - The session is required; the API remains authoritative for Admin authorization, ownership
 *   and lifecycle guards.
 * - Validate the version UUID and importLegalSourceDocumentRequestSchema; remote fetching and
 *   URL safety remain backend responsibilities.
 *
 * Execution flow:
 * 1. Validate the version identity.
 * 2. Validate and forward the import request, then validate its document-view result.
 *
 * Failure cases:
 * - Invalid route identities return the shared 422 problem; session failures, upstream
 *   problems and response-schema failures follow the existing shared proxy policy.
 *
 * Side effects:
 * - One upstream import request; the BFF does not independently fetch the source URL.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { versionId } = await context.params;
  const id = parseLegalSourceRouteId(versionId);
  if (!id) return invalidLegalSourceRouteId();
  return proxyLegalSourceJson(
    request,
    `/admin/legal-source-versions/${id}/documents/import`,
    {
      method: "POST",
      bodySchema: importLegalSourceDocumentRequestSchema,
      responseSchema: legalSourceDocumentViewSchema,
    },
  );
}
