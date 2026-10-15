import type { NextRequest } from "next/server";

import {
  invalidLegalSourceRouteId,
  parseLegalSourceRouteId,
  proxyLegalSourceDelete,
} from "@/lib/server/legal-source-proxy";

type RouteContext = {
  params: Promise<{ versionId: string; documentRowId: string }>;
};

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { versionId, documentRowId } = await context.params;
  const version = parseLegalSourceRouteId(versionId);
  const document = parseLegalSourceRouteId(documentRowId);
  if (!version || !document) return invalidLegalSourceRouteId();
  return proxyLegalSourceDelete(
    request,
    `/admin/legal-source-versions/${version}/documents/${document}`,
  );
}
