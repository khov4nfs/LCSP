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
