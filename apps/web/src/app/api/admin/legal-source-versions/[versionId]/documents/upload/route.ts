import type { NextRequest } from "next/server";

import {
  invalidLegalSourceRouteId,
  parseLegalSourceRouteId,
  proxyLegalSourceUpload,
} from "@/lib/server/legal-source-proxy";

type RouteContext = { params: Promise<{ versionId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const { versionId } = await context.params;
  const id = parseLegalSourceRouteId(versionId);
  if (!id) return invalidLegalSourceRouteId();
  return proxyLegalSourceUpload(
    request,
    `/admin/legal-source-versions/${id}/documents/upload`,
  );
}
