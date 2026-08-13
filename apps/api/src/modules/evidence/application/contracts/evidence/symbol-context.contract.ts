import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "@lcsp/contracts/evidence";

export const SYMBOL_CONTEXT_INCLUDES = {
  categories: "CATEGORIES",
  callers: "CALLERS",
  callees: "CALLEES",
  evidenceRefs: "EVIDENCE_REFS",
} as const;
export type SymbolContextInclude =
  (typeof SYMBOL_CONTEXT_INCLUDES)[keyof typeof SYMBOL_CONTEXT_INCLUDES];
export type SymbolContextResponse = {
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
  result: { symbol: Record<string, unknown> | null; truncated: boolean };
};
