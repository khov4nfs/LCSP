import type { NextRequest } from "next/server";
import { ruleAuditCatalogSchema } from "@lcsp/contracts/assessment-domain";
import { proxyAssessmentJson } from "@/lib/server/assessment-domain-proxy";

/**
 * Business purpose: Present the authenticated customer's pinned selectable rule catalog.
 * Business rules:
 * - Preserve bounded pagination and ownership; pending translations can show canonical text with selection readiness still pending.
 * Execution flow:
 * 1. Forward requested pagination values to the canonical assessment API.
 * 2. Validate the returned catalog envelope before responding.
 * Failure cases:
 * - Session, ownership or schema problems are returned by the shared proxy.
 * Side effects:
 * - Read-only upstream request; no audit work is launched.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const page = new URLSearchParams();
  for (const key of ["offset", "limit"]) {
    const value = request.nextUrl.searchParams.get(key);
    if (value !== null) page.set(key, value);
  }
  const suffix = page.size ? `/rules?${page.toString()}` : "/rules";
  return proxyAssessmentJson(request, (await params).id, suffix, {
    responseSchema: ruleAuditCatalogSchema,
    allowPendingLocalizationFallback: true,
    preservePendingCatalogReadiness: true,
  });
}
