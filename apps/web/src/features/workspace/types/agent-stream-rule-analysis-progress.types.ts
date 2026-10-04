import type { AssessmentAgentStreamEvent } from "@lcsp/contracts/evidence";

import type { AgentStreamRuleHeader } from "./agent-stream-rule.types";
import type { AgentStreamRunOutcome } from "../utils/agent-stream-projection";

export type AgentStreamRuleAnalysisProgressProps = {
  /** Investigate-stage rule headers, including the rule still running. */
  rules: AgentStreamRuleHeader[];
  /** The Rule-analysis turn's events; each rule keeps only its own. */
  events: AssessmentAgentStreamEvent[];
  /** Optional explicit rule order for the progress list. */
  planOrder?: readonly string[];
  /** The dispatch is still running (later unfinished rules are queued). */
  dispatchRunning?: boolean;
  outcome?: AgentStreamRunOutcome;
  /** Only live rule headers were paused; existing context needs keep their result. */
  pausedRuleIds?: ReadonlySet<string>;
};

export type AgentStreamRuleQueue = {
  rules: AgentStreamRuleHeader[];
  /** Rules the running attempt has not reached yet. */
  queuedRuleIds: ReadonlySet<string>;
};
