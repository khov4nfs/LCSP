import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "@lcsp/contracts/evidence";

export const RECONCILIATION_CONTEXT_STATUSES = {
  open: "OPEN",
  resolved: "RESOLVED",
  dismissed: "DISMISSED",
} as const;

export type ReconciliationContextStatus =
  (typeof RECONCILIATION_CONTEXT_STATUSES)[keyof typeof RECONCILIATION_CONTEXT_STATUSES];

export const RECONCILIATION_RESOLUTION_PATHS = {
  humanReconcile: "HUMAN_RECONCILE",
} as const;

export type ReconciliationContextResponse = {
  status: AgenticToolStatus;
  tool_name: AgenticToolName;
  tool_version: string;
  config_hash: string;
  correlation_id: string;
  artifact_versions: { ai_usage_flow_id: string };
  provenance_ref: string;
  coverage_state: AgenticToolCoverageState;
  evidence_refs: string[];
  limitations: string[];
  result: {
    conflicts: Array<{
      conflict_ref: string;
      type: string;
      status: ReconciliationContextStatus;
      score: number;
      summary_key: string;
      evidence_refs: string[];
    }>;
    permitted_resolution_paths: Array<{
      path_id: typeof RECONCILIATION_RESOLUTION_PATHS.humanReconcile;
      required_actor: string;
      required_state: typeof RECONCILIATION_CONTEXT_STATUSES.open;
    }>;
    next_cursor: null;
    truncated: boolean;
  };
};
