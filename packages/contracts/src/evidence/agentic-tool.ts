/** Shared value sets for the mechanical source acquisition tools. */
export const AGENTIC_TOOL_STATUSES = {
  ready: "READY",
  needsInput: "NEEDS_INPUT",
  conflict: "CONFLICT",
  outOfCoverage: "OUT_OF_COVERAGE",
  blocked: "BLOCKED",
  failed: "FAILED",
} as const;

export type AgenticToolStatus =
  (typeof AGENTIC_TOOL_STATUSES)[keyof typeof AGENTIC_TOOL_STATUSES];

export const AGENTIC_TOOL_COVERAGE_STATES = {
  sufficient: "SUFFICIENT",
  partial: "PARTIAL",
  limited: "LIMITED",
  unavailable: "UNAVAILABLE",
} as const;

export type AgenticToolCoverageState =
  (typeof AGENTIC_TOOL_COVERAGE_STATES)[keyof typeof AGENTIC_TOOL_COVERAGE_STATES];
