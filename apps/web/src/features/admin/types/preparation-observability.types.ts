import type { AssessmentAgentStreamEvent } from "@lcsp/contracts/evidence";
import type { AgentExecutionState } from "@lcsp/contracts/assessment";
import type { PreparationSourceUnitsResponse } from "@lcsp/contracts/compliance-rule-set";
import type { RuleSetPreparationRow } from "./compliance-rule-sets.types";
export type PreparationObservabilityProps = {
  run: RuleSetPreparationRow;
  events: AssessmentAgentStreamEvent[];
};
export type PreparationActivityProps = {
  events: AssessmentAgentStreamEvent[];
  frontierCoverage?:
    PreparationSourceUnitsResponse["frontier"]["coverage"] | null;
  frontierCoverageError?: boolean;
  frontierCoverageLoading?: boolean;
  terminal: boolean;
  executionState: AgentExecutionState | null;
  runStatusLabel?: string | null;
  preparationRunId?: string | null;
  connected: boolean;
  directDraft?: boolean;
  hasOlder?: boolean;
  loadingOlder?: boolean;
  historyError?: boolean;
  historyLoading?: boolean;
  onLoadOlder?: () => void;
};
