import {
  ASSESSMENT_RUNTIME_GATE_TOOL_NAMES,
  RULE_ANALYSIS_SUMMARY_TOOL,
  RULE_ANALYSIS_TOOL_PREFIX,
} from "@lcsp/contracts/evidence";

/** Per-rule runtime events use `rule_analysis:{engineeringRuleId}` as tool name. */
export const RULE_ANALYSIS_ACTIVITY_TOOL_PREFIX = RULE_ANALYSIS_TOOL_PREFIX;

/** Once-per-loop rule-count summary event. */
export const RULE_ANALYSIS_ACTIVITY_SUMMARY_TOOL = RULE_ANALYSIS_SUMMARY_TOOL;

export const ENGINEERING_RULE_GATE_TOOL_NAME =
  ASSESSMENT_RUNTIME_GATE_TOOL_NAMES.engineeringRuleGate;
