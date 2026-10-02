import type { AssessmentAgentStreamEvent } from "@lcsp/contracts/evidence";

import type { AgentStreamRuleHeader } from "./agent-stream-rule.types";

export type AgentStreamRuleAnalysisProgressProps = {
  /** Investigate-stage rule headers, including the rule still running. */
  rules: AgentStreamRuleHeader[];
  /** The Rule-analysis turn's events; each rule keeps only its own. */
  events: AssessmentAgentStreamEvent[];
  /** Optional explicit rule order for the progress list. */
  planOrder?: readonly string[];
  /** The dispatch is still running (later unfinished rules are queued). */
  dispatchRunning?: boolean;
};

export type AgentStreamRuleQueue = {
  rules: AgentStreamRuleHeader[];
  /** Rules the running attempt has not reached yet. */
  queuedRuleIds: ReadonlySet<string>;
};
