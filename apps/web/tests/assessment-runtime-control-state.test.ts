import assert from "node:assert/strict";
import { test } from "node:test";
import { ASSESSMENT_RUNTIME_CONTROL_STATES as States } from "@lcsp/contracts/evidence";
import { mergeRuntimeControlResponse } from "../src/lib/api/assessment-runtime-control-state.ts";

test("a delayed Stop response cannot revert a stopped acknowledgement", () => {
  const stopped = {
    state: States.stopped,
    targetRunId: "old",
    requestId: "stop",
  };
  assert.equal(
    mergeRuntimeControlResponse(stopped, {
      ...stopped,
      state: States.stopRequested,
    }),
    stopped,
  );
});
test("a delayed response from the cancelled generation cannot replace resumed state", () => {
  const resumed = {
    state: States.running,
    targetRunId: "new",
    requestId: null,
  };
  assert.equal(
    mergeRuntimeControlResponse(resumed, {
      state: States.resumeRequested,
      targetRunId: "old",
      requestId: "continue",
    }),
    resumed,
  );
});
test("completion wins over delayed stop acknowledgement", () => {
  const completed = {
    state: States.completed,
    targetRunId: "old",
    requestId: "stop",
  };
  assert.equal(
    mergeRuntimeControlResponse(completed, {
      ...completed,
      state: States.stopped,
    }),
    completed,
  );
});

test("Stop for the generation already visible in SSE advances its older unchanged poll cache", () => {
  const olderCache = {
    state: States.resumeRequested,
    targetRunId: "old",
    requestId: "continue",
  };
  const requested = {
    state: States.stopRequested,
    targetRunId: "resumed",
    requestId: "stop",
  };
  assert.equal(
    mergeRuntimeControlResponse(olderCache, requested, {
      targetRunId: "resumed",
      previousTargetRunId: "old",
    }),
    requested,
  );
});

test("an in-flight response cannot replace a newer generation that updated the cache", () => {
  const current = {
    state: States.running,
    targetRunId: "newer",
    requestId: null,
  };
  assert.equal(
    mergeRuntimeControlResponse(
      current,
      {
        state: States.stopRequested,
        targetRunId: "resumed",
        requestId: "stop",
      },
      { targetRunId: "resumed", previousTargetRunId: "old" },
    ),
    current,
  );
});

test("a response for an unexpected target cannot advance an older cache", () => {
  const current = {
    state: States.completed,
    targetRunId: "old",
    requestId: null,
  };
  assert.equal(
    mergeRuntimeControlResponse(
      current,
      {
        state: States.stopRequested,
        targetRunId: "different",
        requestId: "stop",
      },
      { targetRunId: "resumed", previousTargetRunId: "old" },
    ),
    current,
  );
});

test("resumeRequested advances to running upon worker resumption for same targetRunId", () => {
  const current = {
    state: States.resumeRequested,
    targetRunId: "run-1",
    requestId: "req-continue",
  };
  const running = {
    state: States.running,
    targetRunId: "run-1",
    requestId: null,
  };
  assert.equal(mergeRuntimeControlResponse(current, running), running);
});

test("a delayed resumeRequested cannot overwrite an already running state", () => {
  const running = {
    state: States.running,
    targetRunId: "run-1",
    requestId: null,
  };
  const delayedResume = {
    state: States.resumeRequested,
    targetRunId: "run-1",
    requestId: "req-old",
  };
  assert.equal(mergeRuntimeControlResponse(running, delayedResume), running);
});

test("a delayed running response cannot overwrite a stopped state", () => {
  const stopped = {
    state: States.stopped,
    targetRunId: "run-1",
    requestId: "req-stop",
  };
  const delayedRunning = {
    state: States.running,
    targetRunId: "run-1",
    requestId: null,
  };
  assert.equal(mergeRuntimeControlResponse(stopped, delayedRunning), stopped);
});

test("completion wins over running and resumeRequested within same targetRunId", () => {
  const completed = {
    state: States.completed,
    targetRunId: "run-1",
    requestId: null,
  };
  const running = {
    state: States.running,
    targetRunId: "run-1",
    requestId: null,
  };
  assert.equal(mergeRuntimeControlResponse(running, completed), completed);
  assert.equal(mergeRuntimeControlResponse(completed, running), completed);
});
