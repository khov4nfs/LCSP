import type {
  AssessmentRuntimeRunStatus,
  RuleAnalysisActivity,
} from "@lcsp/contracts/evidence";

export const AGENT_STREAM_SEGMENT_KINDS = {
  row: "ROW",
  rule: "RULE",
} as const;

export type AgentStreamSegmentKind =
  (typeof AGENT_STREAM_SEGMENT_KINDS)[keyof typeof AGENT_STREAM_SEGMENT_KINDS];

/** One criterion-scoped claim from an EngineeringRule reasoning result. */
export type AgentStreamRuleClaim = {
  claimType: string;
  criterion: string | null;
  confidence: number | null;
  limitations: string[];
  sourceLocations: string | null;
};

/** Live state of one EngineeringRule inside an agent stream timeline. */
export type AgentStreamRuleHeader = {
  ruleId: string;
  sequence: number;
  status: AssessmentRuntimeRunStatus;
  /** Latest RULE_ANALYSIS_* activity reported for this rule, when any. */
  activity: RuleAnalysisActivity | null;
  concept: string | null;
  goals: string[];
  decision: string | null;
  reasonCode: string | null;
  claims: AgentStreamRuleClaim[];
};

export type AgentStreamRowSegment<TRow> =
  | { kind: typeof AGENT_STREAM_SEGMENT_KINDS.row; row: TRow }
  | {
      kind: typeof AGENT_STREAM_SEGMENT_KINDS.rule;
      header: AgentStreamRuleHeader;
      rows: TRow[];
    };
