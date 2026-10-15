import type { NextRequest } from "next/server";

import {
  invalidLegalSourceRouteId,
  parseLegalSourceRouteId,
  proxyLegalSourceOriginal,
} from "@/lib/server/legal-source-proxy";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ lawId: string }> },
) {
  const { lawId } = await params;
  const documentRowId = parseLegalSourceRouteId(lawId);
  if (!documentRowId) return invalidLegalSourceRouteId();
  return proxyLegalSourceOriginal(
    request,
    `/legal-library/documents/${documentRowId}/original`,
    true,
  );
}
