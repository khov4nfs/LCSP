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
