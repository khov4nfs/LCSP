import { apiRequest } from "./api-request.ts";

export type ProgramEvidenceGraphOverview = {
  modules_analyzed: number | null;
  code_symbols_indexed: number | null;
  ai_model_invocations: number | null;
  evidence_mapped_scope: number | null;
};

export type ProgramEvidenceGraphDetail = {
  repository: {
    repository_full_name: string | null;
    branch: string | null;
    ref: string | null;
    pinned_commit: string | null;
    status: string | null;
  };
  overview: ProgramEvidenceGraphOverview;
  paths: {
    nodes: Array<{
      id: string;
      kind: string;
      label: string;
      symbol: string | null;
      file: string | null;
      line: number | null;
    }>;
    edges: Array<{
      id: string;
      source: string;
      target: string;
      relationship: string;
    }>;
  };
  claims: Array<{
    id: string;
    meaning: string;
    symbol: string | null;
    file: string | null;
    line: number | null;
    evidence_refs: string[];
  }>;
  provenance: {
    evidence_report_id: string;
    snapshot_id: string;
    scan_job_id: string;
    generated_at: string;
    finding: {
      meaning: string;
      evidence_reference: string | null;
      source: {
        file: string | null;
        symbol: string | null;
        start_line: number | null;
        end_line: number | null;
        evidence_reference: string | null;
      } | null;
    } | null;
    source: {
      file: string | null;
      symbol: string | null;
      start_line: number | null;
      end_line: number | null;
      evidence_reference: string | null;
    } | null;
  };
};

/** Normalize optional upstream metric properties to the contract's null sentinel. */
export function normalizeProgramEvidenceGraphDetail(
  detail: ProgramEvidenceGraphDetail,
): ProgramEvidenceGraphDetail {
  const overview = detail.overview ?? {};
  return {
    ...detail,
    overview: {
      modules_analyzed: normalizeMetric(overview.modules_analyzed),
      code_symbols_indexed: normalizeMetric(overview.code_symbols_indexed),
      ai_model_invocations: normalizeMetric(overview.ai_model_invocations),
      evidence_mapped_scope: normalizeMetric(overview.evidence_mapped_scope),
    },
  };
}

function normalizeMetric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function getProgramEvidenceGraphDetail(
  assessmentId: string,
): Promise<ProgramEvidenceGraphDetail | null> {
  const { payload, ok } = await apiRequest(
    `/api/assessments/${encodeURIComponent(assessmentId)}/evidence-graph`,
    { cache: "no-store" },
  );
  return ok
    ? normalizeProgramEvidenceGraphDetail(payload as ProgramEvidenceGraphDetail)
    : null;
}
