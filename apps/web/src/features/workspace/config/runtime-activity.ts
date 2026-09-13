import { ASSESSMENT_RUNTIME_EVENT_TYPES } from "@lcsp/contracts/evidence";

export const TECHNICAL_EVIDENCE_THINKING_LIMIT = 12;

export const ENGINEERING_RULE_ACTIVITY_TOOL_PREFIXES = {
  planner: "engineering_rule_plan:",
  investigator: "engineering_rule_investigation:",
} as const;

export const PRESENTABLE_RUNTIME_ACTIVITY_EVENTS = new Set<string>([
  ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
  ASSESSMENT_RUNTIME_EVENT_TYPES.toolFailed,
  ASSESSMENT_RUNTIME_EVENT_TYPES.toolSkipped,
  ASSESSMENT_RUNTIME_EVENT_TYPES.toolStarted,
  ASSESSMENT_RUNTIME_EVENT_TYPES.toolWaitingInput,
]);
