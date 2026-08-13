import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "@lcsp/contracts/evidence";

export const FINDING_DETAIL_INCLUDES = {
  location: "LOCATION",
  categories: "CATEGORIES",
  confidence: "CONFIDENCE",
  provenance: "PROVENANCE",
  limitations: "LIMITATIONS",
  relatedRefs: "RELATED_REFS",
} as const;

export type FindingDetailInclude =
  (typeof FINDING_DETAIL_INCLUDES)[keyof typeof FINDING_DETAIL_INCLUDES];

export type FindingDetailResponse = {
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
    finding: Record<string, unknown> | null;
  };
};
