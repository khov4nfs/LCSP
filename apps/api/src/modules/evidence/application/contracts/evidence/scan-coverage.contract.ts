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
export type ScanCoverageResponse = {
  status: AgenticToolStatus;
  tool_name: AgenticToolName;
  tool_version: string;
  config_hash: string;
  correlation_id: string;
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
    counts: {
      total: number;
      analyzed: number;
      skipped: number;
      limited: number;
    };
    truncated: boolean;
  };
};
