import {
  ASSESSMENT_AGENT_STREAM_STAGES,
  type AssessmentAgentStreamEvent,
  type AssessmentAgentStreamStage,
} from "@lcsp/contracts/evidence";

import { deriveAgentStreamRunOutcome } from "./agent-stream-projection";
import { projectAgentStreamRuleHeaders } from "./agent-stream-rule-groups";

export type AgentStreamDispatchDiagnostic = {
  runId: string;
  correlationId: string;
  /** event.source — the boundary_name that published this dispatch. */
  boundaryName: string | null;
  stages: AssessmentAgentStreamStage[];
  turnKey: string;
  firstEmittedAt: string;
  lastEmittedAt: string;
  eventCount: number;
  ruleAnalysisRuleIds: string[];
  terminalStatus: ReturnType<typeof deriveAgentStreamRunOutcome>;
};

/**
 * Temporary triage helper: summarize a raw agent-stream event journal by
 * dispatch (runId+correlationId), so a suspected duplicate
 * rule-analysis run can be told apart from a frontend rendering artifact.
 *
 * Two SEPARATE dispatch summaries sharing the same rule-analysis
 * rule sets but DIFFERENT runId/correlationId means the backend genuinely
 * dispatched twice (not a frontend grouping bug — grouping only ever merges
 * events that already share one runId+correlationId). One dispatch summary
 * whose eventCount is higher than the number of distinct eventIds feeding it
 * would instead point at frontend/replay duplication, since it means the
 * same event landed in the accumulator more than once.
 */
export function diagnoseAgentStreamDispatches(
  events: AssessmentAgentStreamEvent[],
): AgentStreamDispatchDiagnostic[] {
  const byDispatch = new Map<
    string,
    {
      runId: string;
      correlationId: string;
      boundaryName: string | null;
      stages: Set<AssessmentAgentStreamStage>;
      events: AssessmentAgentStreamEvent[];
      seenEventIds: Set<string>;
    }
  >();

  for (const event of events) {
    const dispatchKey = `${event.runId}:${event.correlationId}`;
    let entry = byDispatch.get(dispatchKey);
    if (!entry) {
      entry = {
        runId: event.runId,
        correlationId: event.correlationId,
        boundaryName: event.source,
        stages: new Set(),
        events: [],
        seenEventIds: new Set(),
      };
      byDispatch.set(dispatchKey, entry);
    }
    if (event.stage !== null) entry.stages.add(event.stage);
    entry.boundaryName ??= event.source;
    // Deliberately count every occurrence, including a repeated eventId —
    // that repetition is exactly what this helper needs to surface, not
    // silently absorb.
    entry.events.push(event);
    entry.seenEventIds.add(event.eventId);
  }

  return [...byDispatch.entries()]
    .map(([turnKey, entry]) => {
      const ordered = [...entry.events].sort((left, right) => {
        const emittedAt = left.emittedAt.localeCompare(right.emittedAt);
        return emittedAt || left.sequence - right.sequence;
      });
      const stageEvents = (stage: AssessmentAgentStreamStage) =>
        ordered.filter((event) => event.stage === stage);
      const investigatorHeaders = [
        ...projectAgentStreamRuleHeaders(
          stageEvents(ASSESSMENT_AGENT_STREAM_STAGES.ruleAnalysis),
        ).values(),
      ];
      return {
        runId: entry.runId,
        correlationId: entry.correlationId,
        boundaryName: entry.boundaryName,
        stages: [...entry.stages],
        turnKey,
        firstEmittedAt: ordered[0]?.emittedAt ?? "",
        lastEmittedAt: ordered.at(-1)?.emittedAt ?? "",
        eventCount: ordered.length,
        ruleAnalysisRuleIds: investigatorHeaders.map((header) => header.ruleId),
        terminalStatus: deriveAgentStreamRunOutcome(ordered),
      } satisfies AgentStreamDispatchDiagnostic;
    })
    .sort((left, right) => left.firstEmittedAt.localeCompare(right.firstEmittedAt));
}

/**
 * True when the SAME dispatch (runId+correlationId) shows up with a
 * duplicated eventId — i.e. the same event was counted more than once. This
 * is the frontend/replay-duplicate signature specifically; a genuine backend
 * duplicate dispatch instead produces two DIFFERENT dispatch summaries (see
 * diagnoseAgentStreamDispatches's own doc comment).
 */
export function hasDuplicateEventIdsWithinAnyDispatch(
  events: AssessmentAgentStreamEvent[],
): boolean {
  const seenPerDispatch = new Map<string, Set<string>>();
  for (const event of events) {
    const dispatchKey = `${event.runId}:${event.correlationId}`;
    const seen = seenPerDispatch.get(dispatchKey) ?? new Set<string>();
    if (seen.has(event.eventId)) return true;
    seen.add(event.eventId);
    seenPerDispatch.set(dispatchKey, seen);
  }
  return false;
}
