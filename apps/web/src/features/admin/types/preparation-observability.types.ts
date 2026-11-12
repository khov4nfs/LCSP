import type { AssessmentAgentStreamEvent } from "@lcsp/contracts/evidence";
import type { AgentExecutionState } from "@lcsp/contracts/assessment";
import type { RuleSetPreparationRow } from "./compliance-rule-sets.types";
export type PreparationObservabilityProps = {
  run: RuleSetPreparationRow;
  events: AssessmentAgentStreamEvent[];
};
export type PreparationActivityProps = {
  events: AssessmentAgentStreamEvent[];
  terminal: boolean;
  executionState: AgentExecutionState | null;
  connected: boolean;
  directDraft?: boolean;
  hasOlder?: boolean;
  loadingOlder?: boolean;
  historyError?: boolean;
  historyLoading?: boolean;
  onLoadOlder?: () => void;
};
