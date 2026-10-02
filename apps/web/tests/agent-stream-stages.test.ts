import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES,
  ASSESSMENT_AGENT_STREAM_SCHEMA_VERSIONS,
  ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS,
  ASSESSMENT_AGENT_STREAM_STAGES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  type AssessmentAgentStreamEvent,
  type AssessmentAgentStreamStage,
} from "@lcsp/contracts/evidence";

import { projectAgentStreamActivityLog } from "../src/features/workspace/utils/agent-stream-activity-log.ts";
import {
  deriveLatestAgentStreamTurnState,
  groupAgentStreamActivityByTurnKey,
  groupAgentStreamEventsByRun,
  groupAgentStreamEventsByStage,
  interleaveInterviewTranscript,
  splitAgentStreamActivityByStage,
  splitCurrentInterviewActivity,
} from "../src/features/workspace/utils/agent-stream-stages.ts";

function answer(
  questionId: string,
  answeredAt: string,
): import("@lcsp/contracts/evidence").AssessmentInterviewAnswerHistoryItem {
  return { questionId, answeredAt, summary: `answer-${questionId}` };
}

function event(
  sequence: number,
  stage: AssessmentAgentStreamStage | null,
  overrides: Partial<AssessmentAgentStreamEvent> = {},
): AssessmentAgentStreamEvent {
  return {
    eventId: `event-${sequence}`,
    sequence,
    clientSequence: sequence,
    emittedAt: "2026-09-26T00:00:00.000Z",
    assessmentId: "assessment-1",
    runId: "scan-job-1",
    correlationId: "corr-1",
    eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelContentDelta,
    stage,
    engineeringRuleId: null,
    source: null,
    agentName: null,
    subagentName: null,
    namespace: [],
    nodeName: null,
    messageId: null,
    toolName: null,
    toolCallId: null,
    status: null,
    text: `delta-${sequence}`,
    data: null,
    ...overrides,
  };
}

test("outer dispatch termination closes every participating stage but no other turn", () => {
  const stages = ASSESSMENT_AGENT_STREAM_STAGES;
  const types = ASSESSMENT_AGENT_STREAM_EVENT_TYPES;
  for (const terminal of [
    types.boundaryCompleted,
    types.boundaryFailed,
    types.boundaryPaused,
  ]) {
    const grouped = groupAgentStreamEventsByStage([
      event(1, stages.scanner, {
        correlationId: "scanner",
        eventType: types.boundaryStarted,
      }),
      event(2, null, { eventType: types.boundaryStarted }),
      event(3, stages.interview),
      event(4, stages.gate),
      event(5, stages.ruleAnalysis),
      event(6, stages.interview, { eventType: terminal }),
    ]);
    for (const stage of [
      stages.interview,
      stages.gate,
      stages.ruleAnalysis,
    ]) {
      const end = grouped.byStage[stage].at(-1)!;
      assert.equal(end.eventType, terminal);
      assert.equal(end.stage, stage);
      assert.equal(
        deriveLatestAgentStreamTurnState(grouped.byStage[stage]),
        terminal === types.boundaryPaused ? "paused" : "idle",
      );
    }
    assert.deepEqual(
      grouped.byStage[stages.scanner].map((e) => e.sequence),
      [1],
    );
  }
});

test("agent stream events split into one timeline per pipeline stage", () => {
  const grouped = groupAgentStreamEventsByStage([
    event(1, ASSESSMENT_AGENT_STREAM_STAGES.scanner, {
      correlationId: "scan-dispatch",
    }),
    event(2, ASSESSMENT_AGENT_STREAM_STAGES.interview),
    event(3, ASSESSMENT_AGENT_STREAM_STAGES.ruleAnalysis),
    event(4, ASSESSMENT_AGENT_STREAM_STAGES.ruleAnalysis),
    event(5, ASSESSMENT_AGENT_STREAM_STAGES.ruleAnalysis),
    event(6, ASSESSMENT_AGENT_STREAM_STAGES.gate),
    event(7, null, { correlationId: "unattributed-dispatch" }),
  ]);

  const sequences = (events: AssessmentAgentStreamEvent[]) =>
    events.map((item) => item.sequence);
  assert.deepEqual(
    sequences(grouped.byStage[ASSESSMENT_AGENT_STREAM_STAGES.scanner]),
    [1],
  );
  assert.deepEqual(
    sequences(grouped.byStage[ASSESSMENT_AGENT_STREAM_STAGES.interview]),
    [2],
  );
  assert.deepEqual(
    sequences(grouped.byStage[ASSESSMENT_AGENT_STREAM_STAGES.ruleAnalysis]),
    [3, 4, 5],
  );
  assert.deepEqual(
    sequences(grouped.byStage[ASSESSMENT_AGENT_STREAM_STAGES.gate]),
    [6],
  );
  assert.deepEqual(sequences(grouped.unstaged), [7]);
});

test("agent stream events split into one group per run, oldest turn first", () => {
  const groups = groupAgentStreamEventsByRun([
    event(2, ASSESSMENT_AGENT_STREAM_STAGES.interview, {
      runId: "interview-turn-2",
      emittedAt: "2026-09-26T00:05:00.000Z",
    }),
    event(1, ASSESSMENT_AGENT_STREAM_STAGES.interview, {
      runId: "interview-turn-1",
      emittedAt: "2026-09-26T00:00:00.000Z",
    }),
    event(3, ASSESSMENT_AGENT_STREAM_STAGES.interview, {
      runId: "interview-turn-1",
      emittedAt: "2026-09-26T00:01:00.000Z",
    }),
  ]);

  // Each interview turn resumes in its own run; grouping by run keeps every
  // turn's own activity/thinking visible instead of only the latest run.
  assert.deepEqual(
    groups.map((group) => group.runId),
    ["interview-turn-1", "interview-turn-2"],
  );
  assert.deepEqual(
    groups.map((group) => group.events.map((item) => item.sequence)),
    [[1, 3], [2]],
  );
});

test("turn state is idle with no events", () => {
  assert.equal(deriveLatestAgentStreamTurnState([]), "idle");
});

test("resumed interview dispatches sharing a scan job keep separate activity turns", () => {
  const groups = groupAgentStreamEventsByRun([
    event(1, ASSESSMENT_AGENT_STREAM_STAGES.interview, {
      correlationId: "question-dispatch",
      emittedAt: "2026-09-27T11:00:00Z",
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryCompleted,
    }),
    event(2, ASSESSMENT_AGENT_STREAM_STAGES.interview, {
      correlationId: "answer-dispatch",
      emittedAt: "2026-09-27T11:02:00Z",
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallStarted,
    }),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.runId, groups[1]?.runId);
  assert.notEqual(groups[0]?.turnKey, groups[1]?.turnKey);
  const split = splitCurrentInterviewActivity(
    interleaveInterviewTranscript(
      [answer("q-1", "2026-09-27T11:01:00Z")],
      [{ stage: ASSESSMENT_AGENT_STREAM_STAGES.interview, groups }],
    ),
  );
  assert.deepEqual(
    split.history.map((turn) => turn.answer.questionId),
    ["q-1"],
  );
  assert.equal(
    split.history[0]?.followUpActivity[0]?.events[0]?.correlationId,
    "answer-dispatch",
  );
  assert.deepEqual(
    split.currentActivity[0]?.events.map((item) => item.correlationId),
    ["question-dispatch"],
  );
  assert.equal(
    deriveLatestAgentStreamTurnState(groups.flatMap((group) => group.events)),
    "running",
  );
});

test("initial interview activity belongs below the current agent question", () => {
  const split = splitCurrentInterviewActivity(
    interleaveInterviewTranscript(
      [],
      [
        {
          stage: ASSESSMENT_AGENT_STREAM_STAGES.interview,
          groups: groupAgentStreamEventsByRun([
            event(1, ASSESSMENT_AGENT_STREAM_STAGES.interview),
          ]),
        },
      ],
    ),
  );
  assert.deepEqual(split.history, []);
  assert.equal(split.currentActivity.length, 1);
});

test("each answered question retains its activity when later answers and live events arrive", () => {
  const stage = ASSESSMENT_AGENT_STREAM_STAGES.interview;
  const events = [1, 2, 3].map((turn) =>
    event(turn, stage, {
      correlationId: `dispatch-${turn}`,
      emittedAt: `2026-09-27T11:0${turn * 2 + 1}:30Z`,
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryCompleted,
    }),
  );
  const answers = [1, 2, 3].map((turn) =>
    answer(`q-${turn}`, `2026-09-27T11:0${turn * 2 + 1}:00Z`),
  );
  const transcript = (history: typeof answers, journal: typeof events) =>
    splitCurrentInterviewActivity(
      interleaveInterviewTranscript(history, [
        {
          stage,
          groups: groupAgentStreamEventsByRun(journal),
        },
      ]),
    );
  const first = transcript(answers.slice(0, 1), events.slice(0, 1));
  const second = transcript(answers.slice(0, 2), events.slice(0, 2));
  const third = transcript(answers, [
    ...events,
    event(4, stage, {
      correlationId: "dispatch-4",
      emittedAt: "2026-09-27T11:08:00Z",
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallStarted,
    }),
  ]);
  assert.deepEqual(
    second.history[0]?.followUpActivity,
    first.history[0]?.followUpActivity,
  );
  assert.deepEqual(
    third.history.slice(0, 2).map((cycle) => cycle.followUpActivity),
    second.history.map((cycle) => cycle.followUpActivity),
  );
  assert.deepEqual(
    third.history.map((turn) => ({
      questionId: turn.answer.questionId,
      activity: turn.followUpActivity.flatMap((segment) =>
        segment.events.map((item) => item.correlationId),
      ),
    })),
    [1, 2, 3].map((turn) => ({
      questionId: `q-${turn}`,
      activity:
        turn === 3 ? ["dispatch-3", "dispatch-4"] : [`dispatch-${turn}`],
    })),
  );
  assert.deepEqual(third.currentActivity, []);
  // Rehydrating the same durable journal cannot move activity to the latest answer.
  assert.deepEqual(
    transcript(
      answers,
      [
        ...third.history.flatMap((cycle) =>
          cycle.followUpActivity.flatMap((segment) => segment.events),
        ),
      ].reverse(),
    ).history,
    third.history,
  );
});

test("a new interview dispatch cannot change completed scanner activity", () => {
  const scanner = event(1, ASSESSMENT_AGENT_STREAM_STAGES.scanner, {
    eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryCompleted,
    emittedAt: "2026-09-27T11:00:00Z",
  });
  const before = groupAgentStreamEventsByStage([scanner]);
  const after = groupAgentStreamEventsByStage([
    scanner,
    event(2, ASSESSMENT_AGENT_STREAM_STAGES.interview, {
      correlationId: "answer-dispatch",
      emittedAt: "2026-09-27T11:02:00Z",
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallStarted,
    }),
  ]);
  assert.deepEqual(
    after.byStage[ASSESSMENT_AGENT_STREAM_STAGES.scanner],
    before.byStage[ASSESSMENT_AGENT_STREAM_STAGES.scanner],
  );
  assert.equal(
    deriveLatestAgentStreamTurnState(
      after.byStage[ASSESSMENT_AGENT_STREAM_STAGES.scanner],
    ),
    "idle",
  );
  assert.equal(
    deriveLatestAgentStreamTurnState(
      after.byStage[ASSESSMENT_AGENT_STREAM_STAGES.interview],
    ),
    "running",
  );
});

test("downstream dispatch Scanner-tagged observer events never reopen the scan", () => {
  const stages = ASSESSMENT_AGENT_STREAM_STAGES;
  const types = ASSESSMENT_AGENT_STREAM_EVENT_TYPES;
  const scanner = event(1, stages.scanner, {
    correlationId: "scan-dispatch",
    eventType: types.boundaryCompleted,
  });
  const grouped = groupAgentStreamEventsByStage([
    scanner,
    event(2, null, {
      correlationId: "engineering-dispatch",
      eventType: types.boundaryStarted,
    }),
    event(3, stages.scanner, {
      correlationId: "engineering-dispatch",
      eventType: types.runtimeEvent,
    }),
    event(4, stages.ruleAnalysis, {
      correlationId: "engineering-dispatch",
    }),
    event(5, stages.ruleAnalysis, {
      correlationId: "engineering-dispatch",
    }),
  ]);
  assert.deepEqual(grouped.byStage[stages.scanner].map((item) => item.eventId), [scanner.eventId]);
  assert.equal(deriveLatestAgentStreamTurnState(grouped.byStage[stages.scanner]), "idle");
  assert.equal(deriveLatestAgentStreamTurnState(grouped.byStage[stages.ruleAnalysis]), "running");
  assert.ok(grouped.byStage[stages.ruleAnalysis].some((item) => item.eventId === "event-3"));
});

test("untagged interview envelopes join their own turn instead of a standalone timeline", () => {
  const grouped = groupAgentStreamEventsByStage([
    event(1, ASSESSMENT_AGENT_STREAM_STAGES.scanner, {
      correlationId: "scan-dispatch",
    }),
    event(2, null, {
      correlationId: "interview-dispatch",
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryStarted,
    }),
    event(3, ASSESSMENT_AGENT_STREAM_STAGES.interview, {
      correlationId: "interview-dispatch",
    }),
    event(4, null, {
      correlationId: "interview-dispatch",
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryCompleted,
    }),
  ]);
  assert.deepEqual(
    grouped.byStage[ASSESSMENT_AGENT_STREAM_STAGES.scanner].map(
      (item) => item.sequence,
    ),
    [1],
  );
  assert.deepEqual(
    grouped.byStage[ASSESSMENT_AGENT_STREAM_STAGES.interview].map(
      (item) => item.sequence,
    ),
    [2, 3, 4],
  );
  assert.deepEqual(grouped.unstaged, []);
  assert.equal(
    groupAgentStreamEventsByRun(
      grouped.byStage[ASSESSMENT_AGENT_STREAM_STAGES.interview],
    ).length,
    1,
  );
});

test("untagged progress follows stage transitions only inside the same dispatch", () => {
  const grouped = groupAgentStreamEventsByStage([
    event(1, ASSESSMENT_AGENT_STREAM_STAGES.interview),
    event(2, null),
    event(3, ASSESSMENT_AGENT_STREAM_STAGES.ruleAnalysis),
    event(4, null),
    event(5, null, { correlationId: "unknown-dispatch" }),
  ]);
  assert.deepEqual(
    grouped.byStage[ASSESSMENT_AGENT_STREAM_STAGES.interview].map(
      (item) => item.sequence,
    ),
    [1, 2],
  );
  assert.deepEqual(
    grouped.byStage[ASSESSMENT_AGENT_STREAM_STAGES.ruleAnalysis].map(
      (item) => item.sequence,
    ),
    [3, 4],
  );
  assert.deepEqual(
    grouped.unstaged.map((item) => item.sequence),
    [5],
  );
});

test("turn state is running before any terminal event arrives", () => {
  const state = deriveLatestAgentStreamTurnState([
    event(1, ASSESSMENT_AGENT_STREAM_STAGES.interview, {
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelRequest,
    }),
  ]);
  assert.equal(state, "running");
});

test("turn state is idle once the run completes normally", () => {
  const state = deriveLatestAgentStreamTurnState([
    event(1, ASSESSMENT_AGENT_STREAM_STAGES.interview, {
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelRequest,
    }),
    event(2, ASSESSMENT_AGENT_STREAM_STAGES.interview, {
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryCompleted,
    }),
  ]);
  assert.equal(state, "idle");
});

test("turn state is idle when the run genuinely fails, not paused", () => {
  const state = deriveLatestAgentStreamTurnState([
    event(1, ASSESSMENT_AGENT_STREAM_STAGES.interview, {
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.agentFailed,
      data: { reasonCode: "PROVIDER_TIMEOUT" },
    }),
  ]);
  assert.equal(state, "idle");
});

test("turn state is paused when the worker reports a cooperative stop", () => {
  const state = deriveLatestAgentStreamTurnState([
    event(1, ASSESSMENT_AGENT_STREAM_STAGES.interview, {
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelRequest,
    }),
    event(2, ASSESSMENT_AGENT_STREAM_STAGES.interview, {
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.agentFailed,
      data: { reasonCode: "CUSTOMER_REQUESTED_STOP" },
    }),
  ]);
  assert.equal(state, "paused");
});

test("interview transcript interleaves each turn's activity between its own answer and the next one", () => {
  const segments = interleaveInterviewTranscript(
    [
      answer("q-1", "2026-09-27T11:01:00.000Z"),
      answer("q-2", "2026-09-27T11:25:00.000Z"),
    ],
    [
      {
        stage: ASSESSMENT_AGENT_STREAM_STAGES.interview,
        groups: groupAgentStreamEventsByRun([
          // Ran right after q-1 was answered, well before q-2.
          event(1, ASSESSMENT_AGENT_STREAM_STAGES.interview, {
            runId: "turn-1",
            emittedAt: "2026-09-27T11:01:05.000Z",
          }),
          // Ran right after q-2 was answered.
          event(2, ASSESSMENT_AGENT_STREAM_STAGES.interview, {
            runId: "turn-2",
            emittedAt: "2026-09-27T11:25:05.000Z",
          }),
        ]),
      },
      { stage: ASSESSMENT_AGENT_STREAM_STAGES.ruleAnalysis, groups: [] },
      { stage: ASSESSMENT_AGENT_STREAM_STAGES.gate, groups: [] },
    ],
  );

  // Previously every answer rendered first and every activity block rendered
  // afterward as one lump; each run must now sit right after its own turn.
  assert.deepEqual(
    segments.map((segment) =>
      segment.kind === "answer" ? segment.answer.questionId : segment.runId,
    ),
    ["q-1", "turn-1", "q-2", "turn-2"],
  );
});

test("turn state reflects only the latest run, not an earlier paused one", () => {
  const state = deriveLatestAgentStreamTurnState([
    event(1, ASSESSMENT_AGENT_STREAM_STAGES.interview, {
      runId: "turn-1",
      emittedAt: "2026-09-26T00:00:00.000Z",
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.agentFailed,
      data: { reasonCode: "CUSTOMER_REQUESTED_STOP" },
    }),
    event(2, ASSESSMENT_AGENT_STREAM_STAGES.interview, {
      runId: "turn-2",
      emittedAt: "2026-09-26T00:05:00.000Z",
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelRequest,
    }),
  ]);
  assert.equal(state, "running");
});

test("Interview and rule-analysis sharing one dispatch merge into one grouped activity", () => {
  const sharedRunGroups = [
    {
      stage: ASSESSMENT_AGENT_STREAM_STAGES.interview,
      groups: groupAgentStreamEventsByRun([
        event(1, ASSESSMENT_AGENT_STREAM_STAGES.interview, {
          runId: "run-1",
          correlationId: "shared-dispatch",
          emittedAt: "2026-09-27T00:00:00.000Z",
        }),
      ]),
    },
    {
      stage: ASSESSMENT_AGENT_STREAM_STAGES.ruleAnalysis,
      groups: groupAgentStreamEventsByRun([
        event(2, ASSESSMENT_AGENT_STREAM_STAGES.ruleAnalysis, {
          runId: "run-1",
          correlationId: "shared-dispatch",
          emittedAt: "2026-09-27T00:01:00.000Z",
        }),
      ]),
    },
  ];
  const grouped = groupAgentStreamActivityByTurnKey(sharedRunGroups);
  assert.equal(grouped.length, 1);
  assert.deepEqual([...grouped[0]!.stages].sort(), ["INTERVIEW", "RULE_ANALYSIS"]);
  assert.equal(grouped[0]!.events.length, 2);
  assert.equal(grouped[0]!.stageEvents.INTERVIEW?.length, 1);
  assert.equal(grouped[0]!.stageEvents.RULE_ANALYSIS?.length, 1);

  // The interleaved transcript must carry the same merge through, and the
  // append-only history invariant must still hold on the merged segment.
  const segments = interleaveInterviewTranscript(
    [answer("q-1", "2026-09-26T23:59:00.000Z")],
    sharedRunGroups,
  );
  const activitySegments = segments.filter(
    (segment) => segment.kind === "activity",
  );
  assert.equal(
    activitySegments.length,
    1,
    "one dispatch across two stages must be one activity segment, not two",
  );
  const { history } = splitCurrentInterviewActivity(segments);
  assert.equal(history[0]?.followUpActivity.length, 1);
  assert.deepEqual(
    [
      ...(history[0]?.followUpActivity[0] as { stages: string[] }).stages,
    ].sort(),
    ["INTERVIEW", "RULE_ANALYSIS"],
  );
});

test("a dispatch touching only one stage still produces one grouped activity with that stage", () => {
  const grouped = groupAgentStreamActivityByTurnKey([
    {
      stage: ASSESSMENT_AGENT_STREAM_STAGES.gate,
      groups: groupAgentStreamEventsByRun([
        event(1, ASSESSMENT_AGENT_STREAM_STAGES.gate, {
          runId: "run-1",
          correlationId: "gate-only",
        }),
      ]),
    },
  ]);
  assert.equal(grouped.length, 1);
  assert.deepEqual(grouped[0]!.stages, ["GATE"]);
});

function toolCallEvents(
  sequence: number,
  toolName: string,
  toolCallId: string,
  parameters: Record<string, string>,
): AssessmentAgentStreamEvent[] {
  const semantic = {
    schemaVersion: ASSESSMENT_AGENT_STREAM_SCHEMA_VERSIONS.semanticV1,
    toolName,
    toolCallId,
  };
  return [
    event(sequence, ASSESSMENT_AGENT_STREAM_STAGES.scanner, {
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.semanticToolCall,
      toolName,
      toolCallId,
      data: {
        ...semantic,
        kind: ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.toolCall,
        parameters,
      },
    }),
    event(sequence + 1, ASSESSMENT_AGENT_STREAM_STAGES.scanner, {
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.semanticToolResult,
      toolName,
      toolCallId,
      status: ASSESSMENT_RUNTIME_RUN_STATUSES.completed,
      data: {
        ...semantic,
        kind: ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.toolResult,
        result: `result-${toolCallId}`,
      },
    }),
  ];
}

test("scanner activity log keeps one row per activity kind whose count and value update in place", () => {
  const events: AssessmentAgentStreamEvent[] = [];
  for (let turn = 0; turn < 12; turn += 1) {
    events.push(
      ...toolCallEvents(turn * 10 + 1, "read_file", `read-${turn}`, {
        file_path: `/src/file-${turn}.ts`,
      }),
      ...toolCallEvents(turn * 10 + 3, "grep", `grep-${turn}`, {
        pattern: `needle-${turn}`,
      }),
    );
  }
  const rows = projectAgentStreamActivityLog(events);
  const reads = rows.filter((row) => row.activity === "sourceFilesReviewed");
  const searches = rows.filter(
    (row) => row.activity === "repositorySourceSearched",
  );
  assert.equal(reads.length, 1);
  assert.equal(searches.length, 1);
  assert.equal(reads[0]?.count, 12);
  assert.equal(searches[0]?.count, 12);
  // 24 tool calls collapse to a bounded log instead of a flat feed.
  assert.ok(rows.length <= 2);
  assert.match(reads[0]?.target ?? "", /file-11\.ts/);

  // More streaming updates the same row in place: same key, new count and value.
  const more = projectAgentStreamActivityLog([
    ...events,
    ...toolCallEvents(500, "read_file", "read-12", {
      file_path: "/src/file-12.ts",
    }),
  ]);
  const readsAfter = more.find((row) => row.activity === "sourceFilesReviewed");
  assert.equal(readsAfter?.key, reads[0]?.key);
  assert.equal(readsAfter?.count, 13);
  assert.match(readsAfter?.target ?? "", /file-12\.ts/);
  assert.equal(more.length, rows.length);
});

test("a dispatch that fails during rule analysis does not mark its finished Interview failed", () => {
  const interview = ASSESSMENT_AGENT_STREAM_STAGES.interview;
  const investigate = ASSESSMENT_AGENT_STREAM_STAGES.ruleAnalysis;
  const events = [
    event(1, interview, { emittedAt: "2026-09-28T10:30:20.000Z" }),
    event(2, interview, { emittedAt: "2026-09-28T10:32:22.000Z" }),
    event(3, investigate, { emittedAt: "2026-09-28T10:32:23.000Z" }),
    event(4, null, {
      emittedAt: "2026-09-28T10:45:19.000Z",
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryFailed,
      status: ASSESSMENT_RUNTIME_RUN_STATUSES.failed,
    }),
  ];
  const stages = groupAgentStreamEventsByStage(events);
  const [segment] = groupAgentStreamActivityByTurnKey([
    { stage: interview, groups: groupAgentStreamEventsByRun(stages.byStage[interview]) },
    {
      stage: investigate,
      groups: groupAgentStreamEventsByRun(stages.byStage[investigate]),
    },
  ]);
  const [interviewTurn, investigateTurn] = splitAgentStreamActivityByStage(segment!);

  // Interview runs first and ends when it finished, without the dispatch failure.
  assert.equal(interviewTurn!.stage, interview);
  assert.equal(interviewTurn!.events.at(-1)?.emittedAt, "2026-09-28T10:32:22.000Z");
  assert.ok(
    interviewTurn!.events.every(
      (item) => item.eventType !== ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryFailed,
    ),
  );
  // The failure belongs to the rule analysis that was running when it happened.
  assert.equal(investigateTurn!.stage, investigate);
  assert.equal(
    investigateTurn!.events.at(-1)?.eventType,
    ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryFailed,
  );
});

test("a finished rule's investigator agent does not end the running Investigator turn", () => {
  const investigate = ASSESSMENT_AGENT_STREAM_STAGES.ruleAnalysis;
  const events = [
    event(1, investigate, {
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryStarted,
    }),
    event(2, investigate, {
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.agentCompleted,
      engineeringRuleId: "rule-1",
    }),
    event(3, investigate, { engineeringRuleId: "rule-2" }),
  ];
  // Rule 1 is done and rule 2 is running: the composer must still offer stop.
  assert.equal(deriveLatestAgentStreamTurnState(events), "running");
  assert.equal(
    deriveLatestAgentStreamTurnState([
      ...events,
      event(4, investigate, {
        eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryCompleted,
      }),
    ]),
    "idle",
  );
});

test("a customer stop inside a rule pauses the whole Investigator turn", () => {
  const investigate = ASSESSMENT_AGENT_STREAM_STAGES.ruleAnalysis;
  const events = [
    event(1, investigate, {
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryStarted,
    }),
    event(2, investigate, {
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.agentFailed,
      engineeringRuleId: "rule-4",
      data: { reasonCode: "CUSTOMER_REQUESTED_STOP" },
    }),
  ];
  // The composer then offers Resume, which continues from rule 4.
  assert.equal(deriveLatestAgentStreamTurnState(events), "paused");
});

test("Codebase Memory graph queries show as their own activity row, not as grep", () => {
  const events = [
    ...toolCallEvents(1, "search_code_graph", "g-1", { name_pattern: ".*Consent.*" }),
    ...toolCallEvents(3, "trace_call_path", "g-2", { function_name: "submit" }),
    ...toolCallEvents(5, "grep", "t-1", { pattern: "consent" }),
  ];
  const rows = projectAgentStreamActivityLog(events);
  const graph = rows.find((row) => row.key === "codebaseGraphQueried");
  assert.ok(graph, "graph use must be visible in the activity log");
  assert.equal(graph.count, 2);
  assert.equal(
    rows.find((row) => row.key === "repositorySourceSearched")?.count,
    1,
  );
});

test("the rule-analysis queue runs one rule at a time in plan order across retried attempts", async () => {
  const { orderRuleAnalysisRuleQueue } = await import(
    "../src/features/workspace/utils/agent-stream-rule-analysis-progress.ts"
  );
  const header = (ruleId: string, status: string, sequence: number) => ({
    ruleId,
    sequence,
    status: status as typeof ASSESSMENT_RUNTIME_RUN_STATUSES.running,
    activity: null,
    concept: null,
    goals: [],
    decision: null,
    reasonCode: null,
    claims: [],
  });
  const investigate = ASSESSMENT_AGENT_STREAM_STAGES.ruleAnalysis;
  // Attempt 1 died on rule-3 and had touched rule-5; attempt 2 reused 1-2 and
  // is now on rule-4. Loaded history starts mid-attempt, so first-seen order lies.
  const events = [
    event(10, investigate, { engineeringRuleId: "rule-3" }),
    event(11, investigate, { engineeringRuleId: "rule-5" }),
    event(20, investigate, { engineeringRuleId: "rule-1" }),
    event(21, investigate, { engineeringRuleId: "rule-2" }),
    event(22, investigate, { engineeringRuleId: "rule-4" }),
  ];
  const { rules, queuedRuleIds } = orderRuleAnalysisRuleQueue(
    [
      header("rule-5", ASSESSMENT_RUNTIME_RUN_STATUSES.running, 11),
      header("rule-3", ASSESSMENT_RUNTIME_RUN_STATUSES.running, 10),
      header("rule-1", ASSESSMENT_RUNTIME_RUN_STATUSES.completed, 20),
      header("rule-2", ASSESSMENT_RUNTIME_RUN_STATUSES.completed, 21),
      header("rule-4", ASSESSMENT_RUNTIME_RUN_STATUSES.running, 22),
    ],
    events,
    ["rule-1", "rule-2", "rule-3", "rule-4", "rule-5"],
    true,
  );

  assert.deepEqual(
    rules.map((rule) => rule.ruleId),
    ["rule-1", "rule-2", "rule-3", "rule-4", "rule-5"],
  );
  const statusOf = (id: string) => rules.find((rule) => rule.ruleId === id)?.status;
  // Exactly one rule is running: the newest one.
  assert.deepEqual(
    rules.filter((rule) => rule.status === ASSESSMENT_RUNTIME_RUN_STATUSES.running).map((r) => r.ruleId),
    ["rule-4"],
  );
  // Before it: the rule cut off by the dead attempt is stopped.
  assert.equal(statusOf("rule-3"), ASSESSMENT_RUNTIME_RUN_STATUSES.failed);
  // After it: waiting for this attempt to reach it.
  assert.deepEqual([...queuedRuleIds], ["rule-5"]);
});
