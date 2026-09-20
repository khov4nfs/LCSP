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
      ai_usage_role?: string | null;
      evidence_state?: string | null;
      resolution_state?: string | null;
    }>;
    edges: Array<{
      id: string;
      source: string;
      target: string;
      relationship: string;
      evidence_state?: string | null;
      resolution_state?: string | null;
    }>;
    usage_flow_count?: number;
    rendered_usage_flow_count?: number;
    omitted_usage_flow_count?: number;
    usage_group_count?: number;
    rendered_usage_group_count?: number;
    omitted_usage_group_count?: number;
    usage_flow_groups?: Array<{
      key: string;
      label: string;
      source_node_id: string | null;
      source_label: string | null;
      provider_label: string | null;
      gateway_label: string | null;
      usage_flow_count: number;
      rendered_usage_flow_count: number;
      omitted_usage_flow_count: number;
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
  [EVIDENCE_ERROR_CODES.notReady]:
    PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES.pending,
  [EVIDENCE_ERROR_CODES.buildFailed]:
    PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES.failed,
  [EVIDENCE_ERROR_CODES.notFound]:
    PROGRAM_EVIDENCE_GRAPH_DETAIL_LOAD_STATES.notFound,
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
    paths: {
      nodes: detail.paths?.nodes ?? [],
      edges: detail.paths?.edges ?? [],
      usage_flow_count: normalizeCount(detail.paths?.usage_flow_count),
      rendered_usage_flow_count: normalizeCount(
        detail.paths?.rendered_usage_flow_count,
      ),
      omitted_usage_flow_count: normalizeCount(
        detail.paths?.omitted_usage_flow_count,
      ),
      usage_group_count: normalizeCount(detail.paths?.usage_group_count),
      rendered_usage_group_count: normalizeCount(
        detail.paths?.rendered_usage_group_count,
      ),
      omitted_usage_group_count: normalizeCount(
        detail.paths?.omitted_usage_group_count,
      ),
      usage_flow_groups: normalizeUsageFlowGroups(
        detail.paths?.usage_flow_groups,
      ),
    },
  };
}

function normalizeUsageFlowGroups(
  value: unknown,
): NonNullable<ProgramEvidenceGraphDetail["paths"]["usage_flow_groups"]> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const group = entry as Record<string, unknown>;
    const key = typeof group.key === "string" ? group.key : null;
    const label = typeof group.label === "string" ? group.label : null;
    if (!key || !label) return [];
    return [
      {
        key,
        label,
        source_node_id:
          typeof group.source_node_id === "string"
            ? group.source_node_id
            : null,
        source_label:
          typeof group.source_label === "string" ? group.source_label : null,
        provider_label:
          typeof group.provider_label === "string"
            ? group.provider_label
            : null,
        gateway_label:
          typeof group.gateway_label === "string" ? group.gateway_label : null,
        usage_flow_count: normalizeCount(group.usage_flow_count),
        rendered_usage_flow_count: normalizeCount(
          group.rendered_usage_flow_count,
        ),
        omitted_usage_flow_count: normalizeCount(
          group.omitted_usage_flow_count,
        ),
      },
    ];
  });
}

function normalizeMetric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeCount(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : 0;
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
