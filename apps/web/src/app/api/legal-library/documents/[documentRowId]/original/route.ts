import type { NextRequest } from "next/server";

import {
  invalidLegalSourceRouteId,
  parseLegalSourceRouteId,
  proxyLegalSourceOriginal,
} from "@/lib/server/legal-source-proxy";

type RouteContext = { params: Promise<{ documentRowId: string }> };

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
