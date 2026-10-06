import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
  type AgentExecutionState,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_RUNTIME_CONTROL_STATES as States,
  type CanonicalAssessmentRuntimeSnapshot,
} from "@lcsp/contracts/evidence";
import { selectAssessmentComposerRuntimeControl as select } from "../src/features/workspace/utils/assessment-composer-control.ts";

const assessmentId = "11111111-1111-4111-8111-111111111111";
const executionId = "22222222-2222-4222-8222-222222222222";

function canonical(
  executionState: AgentExecutionState,
): CanonicalAssessmentRuntimeSnapshot {
  return {
    assessmentId,
    lifecycle: {
      state: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
      assessmentRevision: 4,
    },
    runtime: {
      threadId: "33333333-3333-4333-8333-333333333333",
      rootAgentVersion: "runtime-v2",
      checkpointNamespace: "44444444-4444-4444-8444-444444444444",
      checkpointId: null,
      currentExecutionId: executionId,
      executionState,
      eventSequence: 9,
      startedAt: "2026-10-03T00:00:00.000Z",
      lastResumedAt: null,
      updatedAt: "2026-10-03T00:00:01.000Z",
    },
  };
}

test("canonical RUNNING projects Stop with the server execution identity", () => {
  assert.deepEqual(select(canonical(AGENT_EXECUTION_STATES.RUNNING), null), {
    state: States.running,
    targetRunId: executionId,
  });
});

test("canonical INTERRUPTED and PAUSED project Continue without event inference", () => {
  for (const executionState of [
    AGENT_EXECUTION_STATES.INTERRUPTED,
    AGENT_EXECUTION_STATES.PAUSED,
  ]) {
    assert.deepEqual(select(canonical(executionState), null), {
      state: States.stopped,
      targetRunId: executionId,
    });
  }
});

test("canonical terminal AES projects completed and cannot be reopened by activity", () => {
  for (const executionState of [
    AGENT_EXECUTION_STATES.SUCCEEDED,
    AGENT_EXECUTION_STATES.FAILED,
    AGENT_EXECUTION_STATES.CANCELLED,
  ]) {
    assert.deepEqual(select(canonical(executionState), null), {
      state: States.completed,
      targetRunId: executionId,
    });
  }
});

test("canonical terminal and paused ALS/AES dominate a same-ID stale RUNNING poll", () => {
  const staleRunning = {
    state: States.running,
    targetRunId: executionId,
    requestId: null,
  };
  const terminal = canonical(AGENT_EXECUTION_STATES.SUCCEEDED);
  terminal.lifecycle = {
    state: ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
    assessmentRevision: 4,
  };
  assert.deepEqual(select(terminal, staleRunning), {
    state: States.completed,
    targetRunId: executionId,
  });

  const paused = canonical(AGENT_EXECUTION_STATES.PAUSED);
  paused.lifecycle = {
    state: ASSESSMENT_LIFECYCLE_STATES.PAUSED,
    assessmentRevision: 4,
  };
  assert.deepEqual(select(paused, staleRunning), {
    state: States.stopped,
    targetRunId: executionId,
  });
});

test("only a matching pending command consistent with canonical state may overlay", () => {
  const stopRequested = {
    state: States.stopRequested,
    targetRunId: executionId,
    requestId: "55555555-5555-4555-8555-555555555555",
  };
  assert.deepEqual(
    select(canonical(AGENT_EXECUTION_STATES.RUNNING), stopRequested),
    stopRequested,
  );
  assert.deepEqual(
    select(canonical(AGENT_EXECUTION_STATES.RUNNING), {
      ...stopRequested,
      state: States.resumeRequested,
    }),
    { state: States.running, targetRunId: executionId },
  );

  const paused = canonical(AGENT_EXECUTION_STATES.PAUSED);
  paused.lifecycle = {
    state: ASSESSMENT_LIFECYCLE_STATES.PAUSED,
    assessmentRevision: 4,
  };
  const resumeRequested = {
    ...stopRequested,
    state: States.resumeRequested,
  };
  assert.deepEqual(select(paused, resumeRequested), resumeRequested);
  assert.deepEqual(
    select(paused, { ...resumeRequested, state: States.stopRequested }),
    { state: States.stopped, targetRunId: executionId },
  );
});

test("missing canonical state is unavailable even when a control poll or events exist", () => {
  assert.deepEqual(
    select(null, {
      state: States.running,
      targetRunId: executionId,
      requestId: null,
    }),
    { state: null },
  );
  const partial = canonical(AGENT_EXECUTION_STATES.RUNNING);
  partial.lifecycle = null;
  assert.deepEqual(
    select(partial, {
      state: States.running,
      targetRunId: executionId,
      requestId: null,
    }),
    { state: null },
  );
});

test("a control acknowledgement is accepted only for the canonical execution", () => {
  const control = {
    state: States.stopRequested,
    targetRunId: executionId,
    requestId: "55555555-5555-4555-8555-555555555555",
  };
  assert.deepEqual(
    select(canonical(AGENT_EXECUTION_STATES.RUNNING), control),
    control,
  );
  assert.deepEqual(
    select(canonical(AGENT_EXECUTION_STATES.RUNNING), {
      ...control,
      targetRunId: "66666666-6666-4666-8666-666666666666",
    }),
    { state: States.running, targetRunId: executionId },
  );
});
