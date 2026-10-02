import { ASSESSMENT_AGENT_STREAM_STAGES } from "@lcsp/contracts/evidence";
import type {
  AgentStreamTurnOutput,
  AgentStreamTurnProps,
} from "../types/agent-stream-turn.types";
import { projectAgentStreamRuleHeaders } from "./agent-stream-rule-groups";

/** Fold the rule-analysis events of the turn into one header per rule. */
export function projectAgentStreamTurnOutput(
  stageEvents: AgentStreamTurnProps["stageEvents"],
): AgentStreamTurnOutput {
  return {
    ruleAnalysisRules: [
      ...projectAgentStreamRuleHeaders(
        stageEvents[ASSESSMENT_AGENT_STREAM_STAGES.ruleAnalysis] ?? [],
      ).values(),
    ],
  };
}
