import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES as Events,
  ASSESSMENT_AGENT_STREAM_STAGES as Stages,
  ASSESSMENT_RUNTIME_CONTROL_STATES as States,
  type AssessmentAgentStreamEvent,
} from "@lcsp/contracts/evidence";
import { selectAssessmentComposerRuntimeControl as select } from "../src/features/workspace/utils/assessment-composer-control.ts";

function event(
  sequence: number,
  overrides: Partial<AssessmentAgentStreamEvent> = {},
): AssessmentAgentStreamEvent {
  return {
    eventId: `event-${sequence}`,
    sequence,
    clientSequence: sequence,
    emittedAt: "2026-10-03T00:00:00.000Z",
    assessmentId: "assessment-1",
    runId: "snapshot-1",
    correlationId: "dispatch-1",
    eventType: Events.modelCallStarted,
    stage: Stages.interview,
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
    text: null,
    data: { runtimeRunId: "native-1" },
    ...overrides,
  };
}

test("live Interview, rule analysis and Gate thinking show Stop before the control poll", () => {
  for (const stage of [Stages.interview, Stages.ruleAnalysis, Stages.gate]) {
    for (const control of [null, undefined]) {
      assert.deepEqual(select([event(1, { stage })], control), {
        state: States.running,
        targetRunId: "native-1",
      });
    }
  }
});

test("legacy live events still show Stop without inventing a native run identity", () => {
  assert.deepEqual(
    select([event(1, { data: null, eventType: Events.boundaryStarted })], null),
    {
      state: States.running,
      targetRunId: undefined,
    },
  );
});

test("a completed older control record cannot offer Continue while a new turn is thinking", () => {
  assert.deepEqual(
    select([event(1)], {
      state: States.completed,
      targetRunId: "previous-native",
      requestId: null,
    }),
    { state: States.running, targetRunId: "native-1" },
  );
});

test("composer uses the same open-boundary outcome as the visible Thinking line", () => {
  const events = [
    event(1, { eventType: Events.boundaryStarted }),
    event(2, { eventType: Events.agentCompleted }),
  ];
  assert.equal(select(events, null).state, States.running);
  events.push(event(3, { eventType: Events.boundaryCompleted }));
  assert.equal(select(events, null).state, null);
});

test("Stop requests stay Stopping until the native runtime acknowledges interruption", () => {
  const events = [
    event(1),
    event(2, { eventType: Events.runtimeStopRequested }),
  ];
  assert.equal(select(events, null).state, States.stopRequested);
  events.push(event(3, { eventType: Events.boundaryPaused }));
  assert.equal(select(events, null).state, States.stopRequested);
  events.push(event(4, { eventType: Events.runtimeStopped }));
  assert.equal(select(events, null).state, States.stopped);
});

test("acknowledged stopped and resuming states win over stale running polls and output", () => {
  const running = {
    state: States.running,
    targetRunId: "native-1",
    requestId: null,
  };
  const events = [event(1), event(2, { eventType: Events.runtimeStopped })];
  events.push(event(3, { eventType: Events.modelCallHeartbeat }));
  assert.equal(select(events, running).state, States.stopped);
  events.push(event(4, { eventType: Events.runtimeResumeRequested }));
  assert.equal(select(events, running).state, States.resumeRequested);
  events.push(event(5, { eventType: Events.runtimeStopRequested }));
  assert.equal(select(events, running).state, States.resumeRequested);
});

test("resumed native acknowledgement shows Stop and targets the resumed generation despite old output", () => {
  const events = [
    event(1, { eventType: Events.runtimeStopped }),
    event(2, { eventType: Events.runtimeResumeRequested }),
    event(3, {
      eventType: Events.runtimeResumed,
      data: { runtimeRunId: "native-2" },
    }),
    event(4, { eventType: Events.modelCallCompleted }),
    event(5, { eventType: Events.modelCallHeartbeat }),
  ];
  for (const control of [
    null,
    {
      state: States.resumeRequested,
      targetRunId: "native-1",
      requestId: "resume-1",
    },
  ]) {
    const projected = select(events, control);
    assert.equal(projected.state, States.running);
    assert.equal(projected.targetRunId, "native-2");
  }
});

test("poll acknowledgement arriving before the new generation's SSE shows Stop", () => {
  assert.equal(
    select([event(1, { eventType: Events.runtimeStopped })], {
      state: States.running,
      targetRunId: "native-2",
      requestId: null,
    }).state,
    States.running,
  );
});

test("a polled stop acknowledgement never becomes running because of old live events", () => {
  for (const state of [
    States.stopRequested,
    States.stopped,
    States.resumeRequested,
    States.completed,
  ]) {
    assert.equal(
      select([event(1)], {
        state,
        targetRunId: "native-1",
        requestId: "request-1",
      }).state,
      state,
    );
  }
});

test("completion wins over late stop acknowledgement and replay is idempotent", () => {
  const events = [
    event(1),
    event(2, { eventType: Events.runtimeCompleted }),
    event(3, { eventType: Events.runtimeStopped }),
    event(4, { eventType: Events.modelCallHeartbeat }),
  ];
  assert.equal(select(events, null).state, States.completed);
  assert.deepEqual(
    select(
      [...events].reverse().flatMap((item) => [item, item]),
      null,
    ),
    select(events, null),
  );
});

test("scanner history alone cannot offer Interview Stop or Continue", () => {
  assert.equal(select([event(1, { stage: Stages.scanner })], null).state, null);
  assert.equal(select([], null).state, null);
});
