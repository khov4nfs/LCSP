import {
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES,
  ASSESSMENT_AGENT_STREAM_SCHEMA_VERSIONS,
  ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  RULE_ANALYSIS_ACTIVITIES,
  type AssessmentAgentStreamEvent,
  type AssessmentRuntimeRunStatus,
  type AssessmentRuntimeSummaryValue,
  type RuleAnalysisActivity,
} from "@lcsp/contracts/evidence";

import {
  AGENT_STREAM_SEGMENT_KINDS,
  type AgentStreamRowSegment,
  type AgentStreamRuleClaim,
  type AgentStreamRuleHeader,
} from "../types/agent-stream-rule.types.ts";

type SummaryRecord = Record<string, AssessmentRuntimeSummaryValue>;

type RuleScopedRow = {
  ruleId: string | null;
  firstSequence: number;
};

/** EngineeringRule lifecycle events render as a rule section, not as a row. */
export function isAgentStreamRuleLifecycleEvent(
  event: AssessmentAgentStreamEvent,
): boolean {
  return ruleLifecycleSemantic(event) !== null;
}

/**
 * Fold every EngineeringRule lifecycle event of a run into one header per rule:
 * which rule is investigated, its status, and its reasoning result.
 */
export function projectAgentStreamRuleHeaders(
  events: AssessmentAgentStreamEvent[],
): Map<string, AgentStreamRuleHeader> {
  const headers = new Map<string, AgentStreamRuleHeader>();
  const ordered = [...events].sort(
    (left, right) => left.sequence - right.sequence,
  );
  for (const event of ordered) {
    const semantic = ruleLifecycleSemantic(event);
    if (semantic === null) continue;
    const ruleId = ruleIdOf(event, semantic);
    if (ruleId === null) continue;
    const header =
      headers.get(ruleId) ?? emptyRuleHeader(ruleId, event.sequence);
    header.status = runStatus(event.status) ?? header.status;
    header.activity = ruleActivity(semantic.activity) ?? header.activity;
    header.concept = stringValue(semantic.concept) ?? header.concept;
    const goals = goalValues(semantic.investigationGoals);
    if (goals.length > 0) header.goals = goals;
    header.decision = stringValue(semantic.decision) ?? header.decision;
    header.reasonCode = stringValue(semantic.reasonCode) ?? header.reasonCode;
    const claims = ruleClaims(semantic.resultSummary);
    if (claims.length > 0) header.claims = claims;
    headers.set(ruleId, header);
  }
  return headers;
}

/**
 * Keep rule-scoped activity together: each rule becomes one section holding its own
 * rows in order, while activity outside any rule stays a plain row.
 */
export function segmentAgentStreamRowsByRule<TRow extends RuleScopedRow>(
  rows: TRow[],
  headers: Map<string, AgentStreamRuleHeader>,
): AgentStreamRowSegment<TRow>[] {
  const segments: AgentStreamRowSegment<TRow>[] = [];
  const ruleSegments = new Map<string, { rows: TRow[] }>();
  const openRule = (ruleId: string, sequence: number) => {
    const existing = ruleSegments.get(ruleId);
    if (existing) return existing;
    const segment = {
      kind: AGENT_STREAM_SEGMENT_KINDS.rule,
      header: headers.get(ruleId) ?? emptyRuleHeader(ruleId, sequence),
      rows: [] as TRow[],
    };
    ruleSegments.set(ruleId, segment);
    segments.push(segment);
    return segment;
  };

  const entries = [
    ...rows.map((row) => ({
      sequence: row.firstSequence,
      row,
      ruleId: row.ruleId,
    })),
    ...[...headers.values()].map((header) => ({
      sequence: header.sequence,
      row: null,
      ruleId: header.ruleId,
    })),
  ].sort((left, right) => left.sequence - right.sequence);

  for (const entry of entries) {
    if (entry.ruleId === null) {
      if (entry.row) {
        segments.push({ kind: AGENT_STREAM_SEGMENT_KINDS.row, row: entry.row });
      }
      continue;
    }
    const segment = openRule(entry.ruleId, entry.sequence);
    if (entry.row) segment.rows.push(entry.row);
  }
  return segments;
}

function ruleLifecycleSemantic(
  event: AssessmentAgentStreamEvent,
): SummaryRecord | null {
  if (event.eventType !== ASSESSMENT_AGENT_STREAM_EVENT_TYPES.engineeringRule) {
    return null;
  }
  const data = isSummaryRecord(event.data) ? event.data : null;
  if (
    data === null ||
    data.schemaVersion !== ASSESSMENT_AGENT_STREAM_SCHEMA_VERSIONS.semanticV1 ||
    (data.kind !== ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.engineeringRule &&
      data.kind !== ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.ruleAnalysis)
  ) {
    return null;
  }
  return ruleIdOf(event, data) === null ? null : data;
}

function ruleActivity(value: unknown): RuleAnalysisActivity | null {
  return (Object.values(RULE_ANALYSIS_ACTIVITIES) as unknown[]).includes(value)
    ? (value as RuleAnalysisActivity)
    : null;
}

function ruleIdOf(
  event: AssessmentAgentStreamEvent,
  semantic: SummaryRecord,
): string | null {
  return event.engineeringRuleId ?? stringValue(semantic.engineeringRuleId);
}

function emptyRuleHeader(
  ruleId: string,
  sequence: number,
): AgentStreamRuleHeader {
  return {
    ruleId,
    sequence,
    status: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
    activity: null,
    concept: null,
    goals: [],
    decision: null,
    reasonCode: null,
    claims: [],
  };
}

function ruleClaims(
  value: AssessmentRuntimeSummaryValue | undefined,
): AgentStreamRuleClaim[] {
  if (!isSummaryRecord(value) || !Array.isArray(value.claims)) return [];
  return value.claims.flatMap((claim) => {
    if (!isSummaryRecord(claim)) return [];
    const claimType = stringValue(claim.claimType);
    if (claimType === null) return [];
    return [
      {
        claimType,
        criterion: stringValue(claim.criterion),
        confidence:
          typeof claim.confidence === "number" ? claim.confidence : null,
        limitations: Array.isArray(claim.limitations)
          ? claim.limitations.filter(
              (item): item is string =>
                typeof item === "string" && item.length > 0,
            )
          : [],
        sourceLocations: stringValue(claim.sourceLocations),
      },
    ];
  });
}

function runStatus(value: string | null): AssessmentRuntimeRunStatus | null {
  return (
    Object.values(ASSESSMENT_RUNTIME_RUN_STATUSES).find(
      (status) => status === value,
    ) ?? null
  );
}

function stringValue(
  value: AssessmentRuntimeSummaryValue | undefined,
): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function goalValues(
  value: AssessmentRuntimeSummaryValue | undefined,
): string[] {
  return Array.isArray(value)
    ? value.filter(
        (goal): goal is string =>
          typeof goal === "string" && goal.trim().length > 0,
      )
    : [];
}

function isSummaryRecord(
  value: AssessmentRuntimeSummaryValue | null | undefined,
): value is SummaryRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
