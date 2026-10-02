import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES as T,
  ASSESSMENT_AGENT_STREAM_SCHEMA_VERSIONS as V,
  ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS as K,
  ASSESSMENT_RUNTIME_RUN_STATUSES as S,
  type AssessmentAgentStreamEvent,
} from "@lcsp/contracts/evidence";

import { projectStreamRows } from "../src/features/workspace/utils/agent-stream-projection.ts";
import { projectRuntimeActivityCounts } from "../src/features/workspace/utils/agent-stream-technical-summary.ts";

function ev(
  sequence: number,
  eventType: AssessmentAgentStreamEvent["eventType"],
  overrides: Partial<AssessmentAgentStreamEvent> = {},
): AssessmentAgentStreamEvent {
  return {
    eventId: `event-${sequence}`,
    sequence,
    clientSequence: sequence,
    emittedAt: new Date(Date.UTC(2026, 8, 20, 0, 0, sequence)).toISOString(),
    assessmentId: "assessment-1",
    runId: "run-1",
    correlationId: "corr-1",
    eventType,
    stage: null,
    engineeringRuleId: null,
    source: "engineering",
    agentName: null,
    subagentName: null,
    namespace: [],
    nodeName: null,
    messageId: null,
    toolName: null,
    toolCallId: null,
    status: S.running,
    text: null,
    data: null,
    ...overrides,
  };
}

/** Shapes the runtime now emits: every logical-turn event carries the same model_step_id. */
function modelTurn(base: number, step: string, message: string) {
  const call = { model_step_id: step, provider: "llm7", model: "m" };
  return [
    ev(base, T.modelCallStarted, { data: call }),
    ev(base + 1, T.modelRequest, {
      agentName: "repository-analyst",
      namespace: ["model"],
      messageId: message,
      data: { requestId: message, model_step_id: step },
    }),
    ev(base + 2, T.modelContentDelta, {
      agentName: "repository-analyst",
      namespace: ["model"],
      messageId: message,
      text: "chunk",
      data: { model_step_id: step },
    }),
    ev(base + 3, T.modelCallHeartbeat, { data: call }),
    ev(base + 4, T.modelCallCompleted, {
      status: S.completed,
      data: {
        ...call,
        provider: "google_genai",
        message_id: message,
        provider_attempts: 3,
        credential_attempts: 4,
        fallback_used: true,
      },
    }),
  ];
}

/** Historical shape: credential rotations/fallback events, no step id on messages. */
function historicalTurn(base: number, step: string, message: string) {
  const call = { model_step_id: step, provider: "llm7", model: "m" };
  return [
    ev(base, T.modelCallStarted, { data: call }),
    ev(base + 1, T.modelRequest, {
      agentName: "repository-analyst",
      namespace: ["model"],
      messageId: message,
      data: { requestId: message },
    }),
    ev(base + 2, T.credentialRotation, { data: { provider: "llm7", credential_slot: 0 } }),
    ev(base + 3, T.providerFallback, {
      data: { current_provider: "llm7", fallback_provider: "google_genai" },
    }),
    ev(base + 4, T.modelCallCompleted, { status: S.completed, data: call }),
  ];
}

const models = (events: AssessmentAgentStreamEvent[]) =>
  projectStreamRows(events).filter((row) => row.kind === "model");

test("one logical model invocation with lifecycle, retries and fallback is one AI activity", () => {
  const events = modelTurn(1, "step-a", "msg-a");
  const rows = models(events);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.status, "completed");
  const counts = projectRuntimeActivityCounts(events);
  assert.equal(counts.rawEventCount, 5);
  assert.equal(counts.logicalModelTurnCount, 1);
  assert.equal(counts.providerAttemptCount, 3);
});

test("one Interview model invocation is one AI activity", () => {
  const events = modelTurn(1, "step-i", "msg-i").map((event) => ({
    ...event,
    stage: "INTERVIEW" as AssessmentAgentStreamEvent["stage"],
  }));
  assert.equal(models(events).length, 1);
});

test("two genuine model turns are two AI activities", () => {
  const events = [...modelTurn(1, "step-a", "msg-a"), ...modelTurn(20, "step-b", "msg-b")];
  assert.equal(models(events).length, 2);
});

test("late stream chunks do not reopen a completed turn", () => {
  const events = [...modelTurn(1, "step-a", "msg-a"), ev(30, T.modelContentDelta, { messageId: "msg-a", text: "late" })];
  assert.equal(models(events)[0]!.status, "completed");
});

test("one tool call with semantic start/result and runtime events is one activity", () => {
  const base = { toolName: "read_file", toolCallId: "call-1", agentName: "ra", namespace: ["tools"] };
  const sem = (kind: string, extra: object) => ({
    schemaVersion: V.semanticV1,
    kind,
    toolName: "read_file",
    toolCallId: "call-1",
    ...extra,
  });
  const events = [
    ev(1, T.toolCallDelta, { ...base, data: { runtimeEventType: "TOOL_STARTED" } }),
    ev(2, T.runtimeEvent, { ...base, data: { runtimeEventType: "TOOL_STARTED" } }),
    ev(3, T.semanticToolCall, { ...base, data: sem(K.toolCall, { parameters: { path: "a.ts" } }) }),
    ev(4, T.semanticToolResult, { ...base, status: S.completed, data: sem(K.toolResult, { resultSummary: "ok" }) }),
    ev(5, T.runtimeEvent, { ...base, status: S.completed, data: { runtimeEventType: "TOOL_COMPLETED" } }),
  ];
  const counts = projectRuntimeActivityCounts(events);
  assert.equal(counts.logicalToolCallCount, 1);
  assert.equal(counts.logicalActivityCount, 1);
  assert.equal(counts.rawEventCount, 5);
});

test("each activity keeps its own technical details", () => {
  const rows = models([...modelTurn(1, "step-a", "msg-a"), ...modelTurn(20, "step-b", "msg-b")]);
  const details = rows.map((row) => JSON.stringify(row.technical));
  assert.match(details[0]!, /"modelStepId":"step-a"/);
  assert.match(details[1]!, /"modelStepId":"step-b"/);
  assert.match(details[0]!, /"providerAttempts":3/);
  assert.match(details[0]!, /"credentialAttempts":4/);
  assert.match(details[0]!, /"fallbackUsed":true/);
  assert.match(details[0]!, /"requestIds":\["msg-a"\]/);
  assert.match(details[0]!, /"durationMs":4000/);
});

test("raw debug events do not inflate logical counts", () => {
  const noise = Array.from({ length: 50 }, (_, i) =>
    ev(100 + i, T.modelReasoningDelta, { messageId: "msg-a", text: "t" }),
  );
  const counts = projectRuntimeActivityCounts([...modelTurn(1, "step-a", "msg-a"), ...noise]);
  assert.equal(counts.rawEventCount, 55);
  assert.equal(counts.logicalModelTurnCount, 1);
});

test("historical events without model_step_id still project by message", () => {
  const events = [
    ev(1, T.modelRequest, { messageId: "old-1", text: "r" }),
    ev(2, T.modelContentDelta, { messageId: "old-1", text: "x" }),
    ev(3, T.modelRequest, { messageId: "old-2", text: "r" }),
  ];
  assert.equal(models(events).length, 2);
});


test("historical routing events are dropped from rows and raw counts", () => {
  const events = historicalTurn(1, "step-h", "msg-h");
  assert.equal(models(events).length, 1);
  assert.equal(projectStreamRows(events).length, 1);
  assert.equal(projectRuntimeActivityCounts(events).rawEventCount, 3);
});

test("interleaved overlapping turns attach exactly by model_step_id", () => {
  const call = (step: string) => ({ model_step_id: step, provider: "p", model: "m" });
  const scope = { agentName: "repository-analyst", namespace: ["model"] };
  const events = [
    ev(1, T.modelCallStarted, { data: call("step-a") }),
    ev(2, T.modelCallStarted, { data: call("step-b") }),
    // No step id on the delta: order pairing would bind it to the latest open turn (B).
    ev(3, T.modelContentDelta, { ...scope, messageId: "msg-a", text: "alpha-text" }),
    ev(4, T.modelContentDelta, { ...scope, messageId: "msg-b", text: "beta-text", data: { model_step_id: "step-b" } }),
    ev(5, T.modelCallCompleted, { status: S.completed, data: { ...call("step-b"), message_id: "msg-b" } }),
    ev(6, T.modelCallCompleted, { status: S.completed, data: { ...call("step-a"), message_id: "msg-a" } }),
  ];
  const rows = models(events);
  assert.equal(rows.length, 2);
  const byStep = (step: string) =>
    rows.find((row) => JSON.stringify(row.technical).includes(`"modelStepId":"${step}"`))!;
  assert.match(byStep("step-a").detail ?? "", /alpha-text/);
  assert.doesNotMatch(byStep("step-a").detail ?? "", /beta-text/);
  assert.match(byStep("step-b").detail ?? "", /beta-text/);
  assert.doesNotMatch(byStep("step-b").detail ?? "", /alpha-text/);
});
