import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES as T,
  ASSESSMENT_AGENT_STREAM_SCHEMA_VERSIONS as V,
  ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS as K,
  ASSESSMENT_RUNTIME_RUN_STATUSES as S,
  type AssessmentAgentStreamEvent,
  type AssessmentRuntimeSummaryValue,
} from "@lcsp/contracts/evidence";
import {
  usageFooterParts,
  aggregateToolUsage,
  attributeToolUsage,
  modelTurnUsage,
  toolCallMetrics,
} from "../src/features/workspace/utils/agent-stream-usage.ts";

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

const call = {
  model_step_id: "step-a",
  provider: "future-provider",
  model: "future-model-v9",
};

function turn(usage: unknown, extra: Record<string, unknown> = {}) {
  return [
    ev(1, T.modelCallStarted, { data: call }),
    ev(2, T.modelRequest, {
      agentName: "ra",
      namespace: ["model"],
      messageId: "m1",
      data: { requestId: "m1" },
    }),
    ev(5, T.modelCallCompleted, {
      status: S.completed,
      data: {
        ...call,
        provider_attempts: 2,
        ...(usage === undefined ? {} : { usage }),
        ...extra,
      } as never,
    }),
  ];
}

const usageOf = (events: AssessmentAgentStreamEvent[]) =>
  modelTurnUsage(events);

test("input/output render with reasoning and thinking, no model logic", () => {
  const usage = usageOf(
    turn({
      input_tokens: 18400,
      output_tokens: 920,
      total_tokens: 19320,
      details: { reasoning_tokens: 2100, thinking_tokens: 50 },
    }),
  );
  const parts = usageFooterParts(usage);
  assert.equal(parts[0], "4s");
  assert.ok(parts.some((p) => p.includes("18,4k") || p.includes("18.4k")));
  assert.ok(parts.some((p) => p.includes("920")));
  assert.equal(parts.filter((p) => /2[.,]1k/.test(p)).length, 1);
  assert.ok(parts.some((p) => p.includes("50")));
  assert.ok(
    parts.some((p) => /19[.,]3k/.test(p)),
    "provider total remains visible alongside input/output",
  );
});

test("total-only renders as tokens", () => {
  const parts = usageFooterParts(usageOf(turn({ total_tokens: 19320 })));
  assert.ok(parts.some((p) => /19[.,]3k/.test(p)));
});

test("unknown future metric renders via humanized fallback", () => {
  const parts = usageFooterParts(
    usageOf(turn({ details: { future_metric_x: 7 } })),
  );
  assert.ok(parts.includes("7 future metric x"));
});

test("no usage: no token footer, no fabricated zero; duration alone survives", () => {
  const usage = usageOf(turn(undefined));
  assert.deepEqual(usage, { durationMs: 4000 });
  const parts = usageFooterParts(usage);
  assert.equal(parts.length, 1);
  assert.ok(!parts.some((p) => /\b0\b/.test(p)));
});

test("failed turn without completed event has no usage", () => {
  const events = [
    ev(1, T.modelCallStarted, { data: call }),
    ev(2, T.modelCallFailed, {
      status: S.failed,
      data: { ...call, error_code: "429" },
    }),
  ];
  assert.equal(usageOf(events), undefined);
});

test("tool activity shows payload metrics and exactly correlated provider tokens", () => {
  const base = {
    toolName: "grep",
    toolCallId: "c1",
    agentName: "ra",
    namespace: ["tools"],
  };
  const sem = (kind: string, extra: object) => ({
    schemaVersion: V.semanticV2,
    kind,
    toolName: "grep",
    toolCallId: "c1",
    ...extra,
  });
  const events = [
    ev(1, T.semanticToolCall, {
      ...base,
      data: sem(K.toolCall, { parameters: { pattern: "x" } }),
    }),
    ev(2, T.semanticToolResult, {
      ...base,
      status: S.completed,
      data: {
        ...sem(K.toolResult, { resultSummary: "ok", model_step_id: "step-a" }),
        result_metrics: {
          bytes: 6451,
          lines: 84,
          truncated: true,
          duration_ms: 110,
          input_tokens: 99,
        },
      },
    }),
    ...turn({
      input_tokens: 18400,
      output_tokens: 920,
      total_tokens: 19320,
      details: { reasoning_tokens: 2100 },
    }).map((event) => ({ ...event, eventId: `model-${event.eventId}` })),
  ];
  const attribution = attributeToolUsage(events, [
    {
      row: { id: "c1", kind: "tool", firstSequence: 1 },
      events: events.filter((event) => event.toolCallId === "c1"),
    },
  ]).get("c1");
  const row = {
    usage: { ...toolCallMetrics(events), ...attribution?.usage },
    usageAttribution: attribution,
  };
  const parts = usageFooterParts(row.usage);
  assert.ok(parts.some((part) => /^84 /.test(part)));
  assert.ok(parts.some((part) => /^6[.,]3 KB$/.test(part)));
  assert.equal(parts.at(-1), "110 ms");
  assert.equal(row.usage?.inputTokens, 18400);
  assert.equal(row.usage?.totalTokens, 19320);
  assert.equal(row.usage?.details?.reasoning_tokens, 2100);
  assert.equal(row.usageAttribution?.accountingOwner, true);
});

test("hostile usage is ignored", () => {
  const huge = Object.fromEntries(
    Array.from({ length: 500 }, (_, i) => [`k${i}`, i]),
  );
  const usage = usageOf(
    turn({
      input_tokens: "12",
      output_tokens: -3,
      total_tokens: Number.NaN,
      details: {
        ...huge,
        Bad_Key: 1,
        "x y": 2,
        neg: -1,
        str: "5",
        ok_metric: 3,
      },
    }),
  );
  assert.equal(usage?.inputTokens, undefined);
  assert.equal(usage?.outputTokens, undefined);
  assert.equal(usage?.totalTokens, undefined);
  assert.ok(Object.keys(usage?.details ?? {}).length <= 16);
  assert.equal(usage?.details?.neg, undefined);
  assert.equal(usage?.details?.str, undefined);
  assert.equal(usage?.details?.["x y"], undefined);
  assert.equal(usageOf(turn("garbage"))?.inputTokens, undefined);
  assert.equal(usageOf(turn([1, 2]))?.inputTokens, undefined);
});

test("reasoning text and secrets never reach usage telemetry", () => {
  const usage = usageOf(
    turn(
      {
        input_tokens: 1,
        details: { reasoning_tokens: 2 },
        reasoning: "SECRET THOUGHT",
        api_key: "sk-secret",
      },
      { reasoning: "SECRET THOUGHT" },
    ),
  );
  const blob = JSON.stringify(usage) + usageFooterParts(usage).join();
  assert.ok(!/SECRET|sk-secret/.test(blob));
});

test("prototype-named detail key does not crash the label lookup", async () => {
  const { usageMetricLabel } =
    await import("../src/features/workspace/utils/agent-stream-usage");
  assert.equal(typeof usageMetricLabel("constructor", "5"), "string");
});

test("duplicate and reordered tool deliveries count one logical model step", () => {
  const completed = turn({
    input_tokens: 10,
    output_tokens: 5,
    total_tokens: 15,
  });
  const a = ev(7, T.semanticToolResult, {
    toolCallId: "a",
    data: { model_step_id: "step-a" },
  });
  const b = ev(6, T.semanticToolResult, {
    toolCallId: "b",
    data: { model_step_id: "step-a" },
  });
  const occurrences = [
    { row: { id: "a", kind: "tool", firstSequence: 7 }, events: [a] },
    { row: { id: "b", kind: "tool", firstSequence: 6 }, events: [b] },
  ];
  const attributed = attributeToolUsage(
    [...completed, b, a, ...completed].reverse(),
    occurrences,
  );
  const rows = occurrences.map(({ row }) => ({
    ...row,
    usageAttribution: attributed.get(row.id),
  }));
  assert.equal(attributed.get("b")?.accountingOwner, true);
  assert.equal(attributed.get("a")?.accountingOwner, false);
  assert.deepEqual(aggregateToolUsage([...rows, ...rows]), {
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    countedModelSteps: 1,
    partial: false,
  });
});
