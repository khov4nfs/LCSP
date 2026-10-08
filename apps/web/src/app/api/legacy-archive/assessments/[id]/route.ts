import type { NextRequest } from "next/server";
import { proxyLegacyArchiveDetail } from "@/lib/server/legacy-archive-proxy";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return proxyLegacyArchiveDetail(request, (await params).id);
}
