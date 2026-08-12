import { AGENTIC_TOOL_NAMES } from "../evidence/agentic-tool.ts";

export const LEGAL_MATCHING_REQUEST_COMMAND =
  "command.legal-matching.requested.v1";

export const RESUME_WAITING_RUNS_TOOL = {
  name: AGENTIC_TOOL_NAMES.resumeWaitingRuns,
  version: "1.0.0",
  configHash: "sha256:resume-waiting-runs-v1",
  maxRuns: 500,
} as const;

