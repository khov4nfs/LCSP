import type { ReactNode } from "react";

import type {
  AssessmentAgentStreamEvent,
  AssessmentAgentStreamStage,
} from "@lcsp/contracts/evidence";

import type { AgentStreamRunOutcome } from "../utils/agent-stream-projection";
import type { AgentStreamRuleHeader } from "./agent-stream-rule.types";
import type { WorkspaceRuntimeAgentStreamHistoryState } from "./workspace-runtime.types";

export type AgentStreamTurnOutput = {
  ruleAnalysisRules: AgentStreamRuleHeader[];
};

export type AgentStreamTurnProps = {
  output?: AgentStreamTurnOutput;
  /** Every stage this one dispatch touched (e.g. [INTERVIEW, RULE_ANALYSIS] when
   *  they ran synchronously inside the same boundary call). */
  stages: AssessmentAgentStreamStage[];
  /** One grouped dispatch's events, already scoped to a single turn by the caller. */
  runId: string;
  events: AssessmentAgentStreamEvent[];
  /** The same events, split back out per stage, for stage-scoped output. */
  stageEvents: Partial<
    Record<AssessmentAgentStreamStage, AssessmentAgentStreamEvent[]>
  >;
  /** Authoritative state (e.g. the scan job) that may close a delayed stream. */
  outcomeOverride?: AgentStreamRunOutcome;
  history?: WorkspaceRuntimeAgentStreamHistoryState;
  onLoadOlder?: () => void;
  /** Turn results owned by the caller (e.g. an Interview answer's outcome);
   *  rendered before Technical details so the raw feed always ends the turn. */
  outputs?: ReactNode;
  className?: string;
};
