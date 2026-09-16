import {
  ASSESSMENT_TECHNICAL_COVERAGE_STATES,
  EVIDENCE_ERROR_CODES,
} from "@lcsp/contracts/evidence";
import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";

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

export const PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES = {
  ready: ASSESSMENT_TECHNICAL_COVERAGE_STATES.ready,
  // UI load state for EVIDENCE_NOT_READY: the graph is still being built.
  pending: "BUILDING",
  failed: REPOSITORY_SCAN_JOB_STATUSES.failed,
  notFound: "NOT_FOUND",
  unavailable: ASSESSMENT_TECHNICAL_COVERAGE_STATES.unavailable,
} as const;

export type ProgramEvidenceGraphDetailLoadState =
  (typeof PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES)[keyof typeof PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES];

type UnavailableProgramEvidenceGraphState = Exclude<
  ProgramEvidenceGraphDetailLoadState,
  typeof PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES.ready
>;

export type ProgramEvidenceGraphDetailLoadResult =
  | {
      state: typeof PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES.ready;
      detail: ProgramEvidenceGraphDetail;
    }
  | { state: UnavailableProgramEvidenceGraphState; detail: null };

const UNAVAILABLE_GRAPH_STATE_BY_PROBLEM_CODE: Record<
  string,
  UnavailableProgramEvidenceGraphState
> = {
  [EVIDENCE_ERROR_CODES.notReady]: PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES.pending,
  [EVIDENCE_ERROR_CODES.buildFailed]: PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES.failed,
  [EVIDENCE_ERROR_CODES.notFound]: PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES.notFound,
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
  const result = await getProgramEvidenceGraphDetailState(assessmentId);
  return result.state === PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES.ready
    ? result.detail
    : null;
}

export async function getProgramEvidenceGraphDetailState(
  assessmentId: string,
): Promise<ProgramEvidenceGraphDetailLoadResult> {
  const { payload, ok } = await apiRequest(
    `/api/assessments/${encodeURIComponent(assessmentId)}/evidence-graph`,
    { cache: "no-store" },
  );
  if (ok) {
    return {
      state: PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES.ready,
      detail: normalizeProgramEvidenceGraphDetail(
        payload as ProgramEvidenceGraphDetail,
      ),
    };
  }

  const problemCode = (payload as { problem?: { code?: string } } | null)
    ?.problem?.code;
  return {
    state:
      (problemCode && UNAVAILABLE_GRAPH_STATE_BY_PROBLEM_CODE[problemCode]) ||
      PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES.unavailable,
    detail: null,
  };
}
