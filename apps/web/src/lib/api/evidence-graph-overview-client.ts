import { apiRequest } from "./api-request.ts";
import type { ProgramEvidenceGraphOverview } from "./evidence-graph-detail-client.ts";

export async function getProgramEvidenceGraphOverview(
  assessmentId: string,
): Promise<ProgramEvidenceGraphOverview | null> {
  const { payload, ok } = await apiRequest(
    `/api/assessments/${encodeURIComponent(assessmentId)}/evidence-graph/overview`,
    { cache: "no-store" },
  );
  if (!ok || typeof payload !== "object" || payload === null) return null;
  const overview = payload as Record<string, unknown>;
  return {
    modules_analyzed: normalizeMetric(overview.modules_analyzed),
    code_symbols_indexed: normalizeMetric(overview.code_symbols_indexed),
    ai_model_invocations: normalizeMetric(overview.ai_model_invocations),
    evidence_mapped_scope: normalizeMetric(overview.evidence_mapped_scope),
  };
}

function normalizeMetric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
