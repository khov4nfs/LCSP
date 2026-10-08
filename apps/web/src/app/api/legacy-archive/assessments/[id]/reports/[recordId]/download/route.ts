import type { NextRequest } from "next/server";
import { proxyLegacyArchiveDownload } from "@/lib/server/legacy-archive-proxy";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; recordId: string }> },
) {
  const { id, recordId } = await params;
  return proxyLegacyArchiveDownload(request, id, recordId);
}
