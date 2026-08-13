import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "@lcsp/contracts/evidence";

export const SCAN_COVERAGE_DISPOSITIONS = {
  analyzed: "ANALYZED",
  skipped: "SKIPPED",
  limited: "LIMITED",
} as const;
export type ScanCoverageDisposition =
  (typeof SCAN_COVERAGE_DISPOSITIONS)[keyof typeof SCAN_COVERAGE_DISPOSITIONS];

export const SCAN_COVERAGE_MAX_RESULTS = 100;

export type ScanCoverageResponse = {
  status: AgenticToolStatus;
  tool_name: AgenticToolName;
  tool_version: string;
  config_hash: string;
  correlationId: string;
  artifact_versions: { technical_evidence_report_id: string };
  provenance_ref: string;
  coverage_state: AgenticToolCoverageState;
  evidence_refs: string[];
  limitations: string[];
  result: {
    files: Array<{
      path: string;
      disposition: ScanCoverageDisposition;
      language: string;
      support_level: string;
      limitation_refs: string[];
    }>;
    searched_scope: {
      artifact_version: string;
      path_prefixes: string[];
      languages: string[];
      dispositions: string[];
      tool_names: string[];
      exhaustive: boolean;
    };
    tool_outcomes: Array<{
      tool_name: string;
      tool_version: string | null;
      outcome: string;
      limitation_refs: string[];
    }>;
    unresolved_dynamic_boundaries: Array<{
      source: string;
      file_path: string | null;
      symbol_ref: string | null;
      reason: string;
      evidence_ref: string | null;
    }>;
    counts: {
      total: number;
      analyzed: number;
      skipped: number;
      limited: number;
    };
    next_cursor: string | null;
    truncated: boolean;
  };
};
