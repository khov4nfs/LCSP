import { NextRequest } from "next/server";
import {
  legalSourceDocumentViewSchema,
  updateLegalSourceDocumentEffectSchema,
} from "@lcsp/contracts/legal-source";

import {
  invalidLegalSourceRouteId,
  parseLegalSourceRouteId,
  proxyLegalSourceJson,
} from "@/lib/server/legal-source-proxy";

/**
 * Business purpose: Forward an Admin’s explicit source-effect metadata update for a document
 *   in its identified version.
 *
 * Business rules:
 * - The session is required; the API remains authoritative for Admin authorization, ownership
 *   and lifecycle guards.
 * - Both identities and updateLegalSourceDocumentEffectSchema must validate; return a
 *   validated document view.
 *
 * Execution flow:
 * 1. Validate the version/document route parameters.
 * 2. Use the shared proxy to validate the effect body, forward PATCH and validate the
 *   document result.
 *
 * Failure cases:
 * - Invalid route identities return the shared 422 problem; session failures, upstream
 *   problems and response-schema failures follow the existing shared proxy policy.
 *
 * Side effects:
 * - One upstream metadata mutation; the backend owns allowed transitions and audit effects.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ versionId: string; documentRowId: string }> },
) {
  const { versionId: rawVersionId, documentRowId: rawDocumentId } =
    await context.params;
  const versionId = parseLegalSourceRouteId(rawVersionId);
  const documentId = parseLegalSourceRouteId(rawDocumentId);
  if (!versionId || !documentId) return invalidLegalSourceRouteId();
  return proxyLegalSourceJson(
    request,
    `/admin/legal-source-versions/${versionId}/documents/${documentId}/effect`,
    {
      bodySchema: updateLegalSourceDocumentEffectSchema,
      responseSchema: legalSourceDocumentViewSchema,
    },
  );
}
