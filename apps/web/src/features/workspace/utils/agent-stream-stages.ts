import {
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES,
  ASSESSMENT_AGENT_STREAM_STAGES,
  type AssessmentAgentStreamEvent,
  type AssessmentAgentStreamStage,
  type AssessmentInterviewAnswerHistoryItem,
} from "@lcsp/contracts/evidence";

import type { AgentStreamTurnOutput } from "../types/agent-stream-turn.types";
import { projectAgentStreamTurnOutput } from "./agent-stream-turn-output";

import type { AgentStreamStageEvents } from "../types/workspace-runtime.types.ts";

/**
 * Split live agent events by pipeline stage so Interview, Investigate and
 * Gate each stream on their own timeline, exactly like the Scanner does.
 */
export function groupAgentStreamEventsByStage(
  events: AssessmentAgentStreamEvent[],
): AgentStreamStageEvents {
  const grouped: AgentStreamStageEvents = {
    byStage: {
      [ASSESSMENT_AGENT_STREAM_STAGES.scanner]: [],
      [ASSESSMENT_AGENT_STREAM_STAGES.interview]: [],
      [ASSESSMENT_AGENT_STREAM_STAGES.ruleAnalysis]: [],
      [ASSESSMENT_AGENT_STREAM_STAGES.gate]: [],
    },
    unstaged: [],
  };
  const ordered = [...events].sort((left, right) => {
    const timestamp = left.emittedAt.localeCompare(right.emittedAt);
    return timestamp || left.sequence - right.sequence;
  });
  const firstStages = new Map<string, AssessmentAgentStreamStage>();
  const downstreamStages = new Map<string, AssessmentAgentStreamStage>();
  for (const event of ordered) {
    const key = agentStreamTurnKey(event);
    if (event.stage !== null && !firstStages.has(key)) {
      firstStages.set(key, event.stage);
    }
    if (
      event.stage !== null &&
      event.stage !== ASSESSMENT_AGENT_STREAM_STAGES.scanner &&
      event.stage !== ASSESSMENT_AGENT_STREAM_STAGES.interview &&
      !downstreamStages.has(key)
    ) {
      downstreamStages.set(key, event.stage);
    }
  }
  for (const [key, stage] of downstreamStages) {
    if (firstStages.get(key) === ASSESSMENT_AGENT_STREAM_STAGES.scanner) {
      firstStages.set(key, stage);
    }
  }
  const activeStages = new Map<string, AssessmentAgentStreamStage>();
  const participatingStages = new Map<
    string,
    Set<AssessmentAgentStreamStage>
  >();
  for (const event of ordered) {
    const key = agentStreamTurnKey(event);
    // Engineering dispatch observers can report SCANNER progress while the
    // rule analysis runs. A dispatch that reaches a downstream stage
    // cannot reopen the repository scan timeline.
    const eventStage =
      event.stage === ASSESSMENT_AGENT_STREAM_STAGES.scanner &&
      downstreamStages.has(key)
        ? null
        : event.stage;
    const dispatchEnded =
      event.eventType ===
        ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryCompleted ||
      event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryFailed ||
      event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryPaused;
    if (dispatchEnded) {
      const stages = participatingStages.get(key);
      if (stages?.size) {
        // The outer boundary may be Interview while its synchronous children
        // are rule-analysis stages. End every participant of this dispatch only.
        for (const participant of stages) {
          grouped.byStage[participant].push({ ...event, stage: participant });
        }
        continue;
      }
    }
    if (eventStage !== null) activeStages.set(key, eventStage);
    // Untagged boundary envelopes belong to their own dispatch's stage, never
    // the previous Scanner run or a separate anonymous completed timeline.
    const stage = eventStage ?? activeStages.get(key) ?? firstStages.get(key);
    if (stage === undefined) {
      grouped.unstaged.push(event);
    } else {
      grouped.byStage[stage].push(
        event.stage === stage ? event : { ...event, stage },
      );
      const stages =
        participatingStages.get(key) ?? new Set<AssessmentAgentStreamStage>();
      stages.add(stage);
      participatingStages.set(key, stages);
    }
  }
  return grouped;
}

function agentStreamTurnKey(event: AssessmentAgentStreamEvent): string {
  return JSON.stringify([event.runId, event.correlationId]);
}

export type AgentStreamRunGroup = {
  turnKey: string;
  runId: string;
  events: AssessmentAgentStreamEvent[];
};

/**
 * Split a stage by dispatch, oldest first. Resumes may share the scan-job runId,
 * but each dispatch carries its own correlationId. Neither a new answer nor a
 * resumed boundary may update an earlier turn's activity block.
 */
export function groupAgentStreamEventsByRun(
  events: AssessmentAgentStreamEvent[],
): AgentStreamRunGroup[] {
  const ordered = [...events].sort((left, right) => {
    const emittedAt = left.emittedAt.localeCompare(right.emittedAt);
    if (emittedAt !== 0) return emittedAt;
    return left.sequence - right.sequence;
  });
  const groups = new Map<string, AssessmentAgentStreamEvent[]>();
  for (const event of ordered) {
    const turnKey = agentStreamTurnKey(event);
    const existing = groups.get(turnKey);
    if (existing) {
      existing.push(event);
    } else {
      groups.set(turnKey, [event]);
    }
  }
  return [...groups.entries()].map(([turnKey, runEvents]) => ({
    turnKey,
    runId: runEvents[0]!.runId,
    events: runEvents,
  }));
}

export const AGENT_STREAM_TURN_STATES = {
  running: "running",
  paused: "paused",
  idle: "idle",
} as const;
export type AgentStreamTurnState =
  (typeof AGENT_STREAM_TURN_STATES)[keyof typeof AGENT_STREAM_TURN_STATES];

// Matches orchestration/agent_stream.py's AgentStreamInterrupted handling: the
// worker tags the AGENT_FAILED it emits on a cooperative stop with this reason
// code, distinguishing "customer clicked stop" from a genuine failure.
const CUSTOMER_REQUESTED_STOP_REASON_CODE = "CUSTOMER_REQUESTED_STOP";

/**
 * Derive the composer's stop/play/send button state from the most recent run
 * of one stage's events: "running" while no terminal event has arrived yet,
 * "paused" once the worker reports a cooperative stop, "idle" once the turn
 * completes or genuinely fails (back to the plain send button either way).
 */
export function deriveLatestAgentStreamTurnState(
  events: AssessmentAgentStreamEvent[],
): AgentStreamTurnState {
  const latest = groupAgentStreamEventsByRun(events).at(-1);
  if (!latest) return "idle";

  let pausedByCustomer = false;
  let terminal = false;
  for (const event of latest.events) {
    // Rule analysis runs one agent per EngineeringRule; that agent finishing
    // (or failing) ends its rule, not the turn — the next rule is still to come.
    // A customer stop inside a rule does stop the whole turn.
    const ruleScopedCustomerStop =
      event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.agentFailed &&
      isCustomerRequestedStop(event.data);
    if (event.engineeringRuleId && !ruleScopedCustomerStop) continue;
    if (
      event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryPaused
    ) {
      terminal = true;
      pausedByCustomer = true;
      continue;
    }
    const failed =
      event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.agentFailed ||
      event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryFailed;
    const completed =
      event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.agentCompleted ||
      event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryCompleted;
    if (failed) {
      terminal = true;
      pausedByCustomer = isCustomerRequestedStop(event.data);
    } else if (completed) {
      terminal = true;
      pausedByCustomer = false;
    }
  }
  if (pausedByCustomer) return "paused";
  return terminal ? "idle" : "running";
}

function isCustomerRequestedStop(data: unknown): boolean {
  return (
    data !== null &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    (data as Record<string, unknown>).reasonCode ===
      CUSTOMER_REQUESTED_STOP_REASON_CODE
  );
}

export type AgentStreamGroupedActivity = {
  turnKey: string;
  runId: string;
  /** Every stage that participated in this one dispatch, first-touched order. */
  stages: AssessmentAgentStreamStage[];
  /** All of this dispatch's events across every participating stage, ordered. */
  events: AssessmentAgentStreamEvent[];
  /** The same events, split back out per stage — for stage-scoped output/rule
   *  projection (selection decisions vs. per-rule analysis results). */
  stageEvents: Partial<
    Record<AssessmentAgentStreamStage, AssessmentAgentStreamEvent[]>
  >;
};

/**
 * One boundary dispatch (a single runId+correlationId) can span multiple
 * stages when analysis/Gate run synchronously inside it — the
 * same turnKey shows up once per participating stage in stageRunGroups.
 * Merge those into one grouped activity per turnKey, so the transcript shows
 * one agent turn per dispatch, not one per stage.
 */
export function groupAgentStreamActivityByTurnKey(
  stageRunGroups: Array<{
    stage: AssessmentAgentStreamStage;
    groups: AgentStreamRunGroup[];
  }>,
): AgentStreamGroupedActivity[] {
  const byTurnKey = new Map<string, AgentStreamGroupedActivity>();
  for (const { stage, groups } of stageRunGroups) {
    for (const group of groups) {
      let entry = byTurnKey.get(group.turnKey);
      if (!entry) {
        entry = {
          turnKey: group.turnKey,
          runId: group.runId,
          stages: [],
          events: [],
          stageEvents: {},
        };
        byTurnKey.set(group.turnKey, entry);
      }
      entry.stages.push(stage);
      entry.stageEvents[stage] = group.events;
      entry.events.push(...group.events);
    }
  }
  return [...byTurnKey.values()].map((entry) => ({
    ...entry,
    // Terminal events are deliberately copied into each stage for lifecycle
    // closure. The merged raw dispatch contains each actual event only once.
    events: uniqueAgentStreamEvents(entry.events).sort((left, right) => {
      const emittedAt = left.emittedAt.localeCompare(right.emittedAt);
      return emittedAt || left.sequence - right.sequence;
    }),
  }));
}

/** Keep the first copy so the outer boundary keeps its original stage. */
function uniqueAgentStreamEvents(events: AssessmentAgentStreamEvent[]) {
  const unique = new Map<string, AssessmentAgentStreamEvent>();
  for (const event of events) {
    if (!unique.has(event.eventId)) unique.set(event.eventId, event);
  }
  return [...unique.values()];
}

export type InterviewTranscriptSegment =
  | {
      kind: "answer";
      timestamp: number;
      answer: AssessmentInterviewAnswerHistoryItem;
    }
  | ({
      kind: "activity";
      timestamp: number;
    } & AgentStreamGroupedActivity);

/**
 * Interleave past Interview answers with follow-up agent activity,
 * in the order they actually happened. Without this, every answer
 * renders first and every activity run renders afterward as one lump at the
 * end of the transcript, disconnected from the turn it belongs to.
 */
export function interleaveInterviewTranscript(
  answerHistory: AssessmentInterviewAnswerHistoryItem[],
  stageRunGroups: Array<{
    stage: AssessmentAgentStreamStage;
    groups: AgentStreamRunGroup[];
  }>,
): InterviewTranscriptSegment[] {
  const segments: InterviewTranscriptSegment[] = [];
  for (const answer of answerHistory) {
    segments.push({
      kind: "answer",
      timestamp: Date.parse(answer.answeredAt) || 0,
      answer,
    });
  }
  for (const grouped of groupAgentStreamActivityByTurnKey(stageRunGroups)) {
    const first: AssessmentAgentStreamEvent | undefined = grouped.events[0];
    segments.push({
      kind: "activity",
      timestamp: first ? Date.parse(first.emittedAt) || 0 : 0,
      ...grouped,
    });
  }
  // Array.prototype.sort is stable, so same-timestamp ties (an activity run
  // starting the instant an answer is recorded) keep answers first.
  segments.sort((left, right) => left.timestamp - right.timestamp);
  return segments;
}

export type InterviewCycle = {
  question: AssessmentInterviewAnswerHistoryItem["question"];
  answer: AssessmentInterviewAnswerHistoryItem;
  followUpActivity: AgentStreamGroupedActivity[];
  /** Dispatch outputs remain stage-scoped; the turn renderer projects their results. */
  output: AgentStreamTurnOutput[];
  nextQuestion?: AssessmentInterviewAnswerHistoryItem["question"];
};

/** Assign a dispatch to the latest preceding answer, using its start time.
 * Initial question-generation activity has no triggering answer and stays separate.
 * A dispatch is never split when it continues beyond the next answer. */
export function splitCurrentInterviewActivity(
  segments: InterviewTranscriptSegment[],
  currentQuestion?: InterviewCycle["question"],
) {
  const history: InterviewCycle[] = [];
  const currentActivity: AgentStreamGroupedActivity[] = [];
  for (const segment of segments) {
    if (segment.kind === "answer") {
      history.push({
        question: segment.answer.question,
        answer: segment.answer,
        followUpActivity: [],
        output: [],
      });
    } else {
      const cycle = history.at(-1);
      if (cycle) {
        cycle.followUpActivity.push(segment);
        cycle.output.push(projectAgentStreamTurnOutput(segment.stageEvents));
      } else currentActivity.push(segment);
    }
  }
  for (let index = 0; index < history.length - 1; index++) {
    history[index]!.nextQuestion = history[index + 1]!.question;
  }
  const latest = history.at(-1);
  if (latest && currentQuestion) latest.nextQuestion = currentQuestion;
  return { history, currentActivity };
}

/** One dispatch split into one agent turn per participating stage, so e.g.
 *  the analysis gets its own turn instead of growing inside the Interview's. */
export type AgentStreamStageTurn = AgentStreamGroupedActivity & {
  stage: AssessmentAgentStreamStage;
  /** A later stage of the same dispatch has already started. */
  superseded: boolean;
};

export function splitAgentStreamActivityByStage(
  segment: AgentStreamGroupedActivity,
): AgentStreamStageTurn[] {
  const stages = segment.stages;
  const staged = new Set(
    segment.stages.flatMap((stage) => segment.stageEvents[stage] ?? []),
  );
  // Stage-less dispatch events (boundary bookkeeping, e.g. the dispatch's final
  // failure) belong to whichever stage was active when they were emitted — a
  // timeout during investigation must not mark the finished Interview failed.
  const stageStarts = stages.map((stage) =>
    Math.min(
      ...(segment.stageEvents[stage] ?? []).map(
        (event) => Date.parse(event.emittedAt) || 0,
      ),
    ),
  );
  const unstagedByIndex = new Map<number, AssessmentAgentStreamEvent[]>();
  for (const event of segment.events) {
    if (staged.has(event)) continue;
    const at = Date.parse(event.emittedAt) || 0;
    let owner = 0;
    stageStarts.forEach((start, index) => {
      if (start <= at) owner = index;
    });
    const owned = unstagedByIndex.get(owner);
    if (owned) owned.push(event);
    else unstagedByIndex.set(owner, [event]);
  }
  return stages.map((stage, index) => {
    const superseded = index < stages.length - 1;
    // Grouping copies the dispatch's end event into every participating
    // stage; only the stage that was running when it ended owns it, so a
    // finished stage does not inherit the next stage's failure or time.
    const own = (segment.stageEvents[stage] ?? []).filter(
      (event) => !superseded || !isDispatchEndEvent(event),
    );
    const events = [...(unstagedByIndex.get(index) ?? []), ...own].sort(
      (a, b) => a.sequence - b.sequence,
    );
    return {
      turnKey: `${segment.turnKey}:${stage}`,
      runId: segment.runId,
      stages: [stage],
      stage,
      events,
      stageEvents: { [stage]: own },
      superseded,
    };
  });
}

function isDispatchEndEvent(event: AssessmentAgentStreamEvent): boolean {
  return (
    event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryCompleted ||
    event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryFailed ||
    event.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryPaused
  );
}
