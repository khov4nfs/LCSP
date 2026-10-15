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
