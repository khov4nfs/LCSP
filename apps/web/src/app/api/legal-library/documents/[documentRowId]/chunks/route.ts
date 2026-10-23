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
