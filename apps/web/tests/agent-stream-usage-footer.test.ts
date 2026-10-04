import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

import {
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES as T,
  ASSESSMENT_AGENT_STREAM_SCHEMA_VERSIONS as V,
  ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS as K,
  ASSESSMENT_RUNTIME_RUN_STATUSES as S,
  ASSESSMENT_RUNTIME_CONTROL_STATES as C,
  ASSESSMENT_AGENT_STREAM_STAGES as Stages,
  type AssessmentAgentStreamEvent,
  type AssessmentRuntimeSummaryValue,
} from "@lcsp/contracts/evidence";

const fixture = JSON.parse(
  await readFile(
    new URL(
      "../src/public/assets/mocks/agent-stream-token-usage.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  steps: Array<{
    id: string;
    sequence: number;
    usage: AssessmentRuntimeSummaryValue;
    tools: Array<{ id: string; name: string; path: string }>;
  }>;
  result_metrics: AssessmentRuntimeSummaryValue;
};

import {
  projectStreamRows,
  groupRepeatedActivities,
  projectAgentStreamUsage,
  projectCurrentRunUsage,
  AGENT_STREAM_RUN_OUTCOMES,
} from "../src/features/workspace/utils/agent-stream-projection.ts";
import {
  usageFooterParts,
  aggregateToolUsage,
} from "../src/features/workspace/utils/agent-stream-usage.ts";
import { projectAssessmentRuntimeUsage } from "../src/features/workspace/utils/assessment-runtime-usage.ts";

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
  projectStreamRows(events).find((r) => r.kind === "model")!.usage;

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

test("failed attempt without usage does not fabricate tokens; attempts not double counted", () => {
  const events = turn({ input_tokens: 10, output_tokens: 5 });
  const rows = projectStreamRows(events).filter((r) => r.kind === "model");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.providerAttempts, 2);
  assert.equal(rows[0]!.usage?.inputTokens, 10);
  assert.equal(rows[0]!.usage?.outputTokens, 5);
  assert.equal(rows[0]!.usage?.totalTokens, undefined);
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
    schemaVersion: V.semanticV1,
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
  const row = projectStreamRows(events).find((r) => r.kind === "tool")!;
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

test("technical details list usage and attempts", () => {
  const row = projectStreamRows(turn({ input_tokens: 10 })).find(
    (r) => r.kind === "model",
  )!;
  const blob = JSON.stringify(row.technical);
  assert.match(blob, /"usage":\{"durationMs":4000,"inputTokens":10\}/);
  assert.match(blob, /future-model-v9/);
});

test("historical events without usage render normally", () => {
  const events = [ev(1, T.modelRequest, { messageId: "old", text: "r" })];
  const row = projectStreamRows(events).find((r) => r.kind === "model")!;
  assert.equal(row.usage, undefined);
  assert.deepEqual(usageFooterParts(row.usage), []);
});

test("prototype-named detail key does not crash the label lookup", async () => {
  const { usageMetricLabel } =
    await import("../src/features/workspace/utils/agent-stream-usage");
  assert.equal(typeof usageMetricLabel("constructor", "5"), "string");
});

function stepEvents(
  index: number,
  overrides: Partial<AssessmentAgentStreamEvent> = {},
) {
  const step = fixture.steps[index]!;
  return [
    ev(step.sequence, T.modelCallCompleted, {
      ...overrides,
      status: S.completed,
      data: {
        model_step_id: step.id,
        message_id: `message-${step.id}`,
        usage: step.usage,
        ...(overrides.data as object),
      },
    }),
    ...step.tools.flatMap((tool, order) => {
      const base = {
        ...overrides,
        agentName: "ra",
        toolName: tool.name,
        toolCallId: tool.id,
        messageId: `message-${step.id}`,
      };
      return [
        ev(step.sequence + 1 + order * 2, T.semanticToolCall, {
          ...base,
          data: {
            schemaVersion: V.semanticV1,
            kind: K.toolCall,
            toolName: tool.name,
            toolCallId: tool.id,
            model_step_id: step.id,
            parameters:
              tool.name === "grep"
                ? { pattern: tool.path }
                : { path: tool.path },
            ...(overrides.data as object),
          },
        }),
        ev(step.sequence + 2 + order * 2, T.semanticToolResult, {
          ...base,
          status: S.completed,
          data: {
            schemaVersion: V.semanticV1,
            kind: K.toolResult,
            toolName: tool.name,
            toolCallId: tool.id,
            model_step_id: step.id,
            resultSummary: "ok",
            result_metrics: fixture.result_metrics,
            ...(overrides.data as object),
          },
        }),
      ];
    }),
  ];
}

test("one step with parallel tools displays usage on both and counts earliest occurrence only", () => {
  const rows = projectStreamRows(stepEvents(0)).filter(
    (row) => row.kind === "tool",
  );
  assert.deepEqual(
    rows.map((row) => row.usage?.totalTokens),
    [10000, 10000],
  );
  assert.deepEqual(
    rows.map((row) => row.usageAttribution?.accountingOwner),
    [true, false],
  );
  assert.equal(groupRepeatedActivities(rows)[0]?.usage?.totalTokens, 10000);
  assert.deepEqual(aggregateToolUsage(rows), {
    usage: {
      inputTokens: 9500,
      outputTokens: 500,
      totalTokens: 10000,
      details: { reasoning_tokens: 800 },
    },
    countedModelSteps: 1,
    partial: false,
  });
});

test("groups across steps count A+C reads as 14k and B search as 6k; turn equals 20k", () => {
  const events = [0, 1, 2].flatMap((index) => stepEvents(index));
  const rows = groupRepeatedActivities(projectStreamRows(events));
  const read = rows.find((row) => row.activity === "sourceFilesReviewed")!;
  const search = rows.find(
    (row) => row.activity === "repositorySourceSearched",
  )!;
  assert.equal(read.completedTurns?.length, 3);
  assert.equal(read.usage?.totalTokens, 14000);
  assert.equal(search.usage?.totalTokens, 6000);
  assert.equal(aggregateToolUsage(rows).usage?.totalTokens, 20000);
  assert.equal(projectAgentStreamUsage(events).usage?.totalTokens, 20000);
});

test("one model step across different groups contributes only to the owner's group", () => {
  const events = stepEvents(0).map((event) => {
    if (event.toolCallId !== "read-2") return event;
    return {
      ...event,
      toolName: "grep",
      data: {
        ...(event.data as object),
        toolName: "grep",
        parameters: { pattern: "test" },
      },
    };
  });
  const groups = groupRepeatedActivities(projectStreamRows(events)).filter(
    (row) => row.kind === "tool",
  );
  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.usageAttribution?.accountingOwner, true);
  assert.equal(groups[1]?.usageAttribution?.accountingOwner, false);
  assert.equal(aggregateToolUsage([groups[1]!]).usage, undefined);
  assert.equal(aggregateToolUsage(groups).usage?.totalTokens, 10000);
});

test("multiple turns accumulate 32k; duplicated and reordered SSE/history cannot inflate totals", () => {
  const first = [0, 1, 2].flatMap((index) => stepEvents(index));
  const second = stepEvents(3, { correlationId: "corr-2" });
  const all = [...first, ...second];
  assert.equal(projectAgentStreamUsage(first).usage?.totalTokens, 20000);
  assert.equal(projectAgentStreamUsage(second).usage?.totalTokens, 12000);
  const aggregate = projectCurrentRunUsage(all, "run-1");
  assert.equal(aggregate.usage?.totalTokens, 32000);
  assert.deepEqual(
    projectCurrentRunUsage([...all, ...all].reverse(), "run-1"),
    aggregate,
  );
  assert.deepEqual(
    projectCurrentRunUsage(
      [
        ...all,
        ...all.map((event) => ({
          ...event,
          eventId: `replay-${event.eventId}`,
        })),
      ].reverse(),
      "run-1",
    ),
    aggregate,
  );
});

test("switching runs and reused scan-job native generations isolates historical usage", () => {
  const old = stepEvents(0, { runId: "old" });
  const current = stepEvents(3);
  const events = [...old, ...current];
  assert.equal(
    projectCurrentRunUsage(events, "run-1").usage?.totalTokens,
    12000,
  );
  assert.equal(projectCurrentRunUsage(events, "old").usage?.totalTokens, 10000);
  assert.equal(
    projectCurrentRunUsage(events, "new-without-events").usage,
    undefined,
  );
  const nativeOld = stepEvents(0, { data: { runtimeRunId: "native-old" } });
  const nativeNew = stepEvents(3, { data: { runtimeRunId: "native-new" } });
  const nativeEvents = [...nativeOld, ...nativeNew];
  assert.equal(
    projectCurrentRunUsage(nativeEvents, "run-1").usage?.totalTokens,
    12000,
  );
  assert.equal(
    projectCurrentRunUsage(nativeEvents, "run-1", "native-old").usage
      ?.totalTokens,
    10000,
  );
  assert.equal(
    projectCurrentRunUsage(nativeEvents, "run-1", "native-next").usage,
    undefined,
  );
});

test("failed provider attempts are excluded; only final logical completion contributes", () => {
  const events = stepEvents(0);
  const attempts = [
    ev(1, T.modelCallFailed, {
      status: S.failed,
      data: { model_step_id: "A", usage: { total_tokens: 99999 } },
    }),
    ev(2, T.providerFallback, {
      data: { model_step_id: "A", current_provider: "failed" },
    }),
    ev(3, T.modelCallCompleted, {
      status: S.completed,
      data: { model_step_id: "A", usage: { total_tokens: 123 } },
    }),
    ...events,
  ];
  assert.equal(projectAgentStreamUsage(attempts).usage?.totalTokens, 10000);
  assert.equal(
    projectAgentStreamUsage(
      attempts.filter((event) => event.eventType !== T.modelCallCompleted),
    ).usage,
    undefined,
  );
});

test("exact message fallback works; no proximity guessing, no estimated or fabricated total", () => {
  const events = stepEvents(0);
  const byMessage = events.map((event) => {
    const data = { ...(event.data as Record<string, unknown>) };
    delete data.model_step_id;
    return { ...event, data: data as AssessmentAgentStreamEvent["data"] };
  });
  assert.equal(projectAgentStreamUsage(byMessage).usage?.totalTokens, 10000);
  const uncorrelated = byMessage.map((event) =>
    event.toolCallId ? { ...event, messageId: null } : event,
  );
  const missing = projectAgentStreamUsage(uncorrelated);
  assert.equal(missing.usage, undefined);
  assert.equal(missing.partial, true);
  assert.equal(
    projectStreamRows(uncorrelated).find((row) => row.kind === "tool")?.usage
      ?.bytes,
    116,
  );
  const inputOnly = events.map((event) =>
    event.eventType === T.modelCallCompleted
      ? {
          ...event,
          data: {
            ...(event.data as object),
            usage: { input_tokens: 10, output_tokens: 5 },
          },
        }
      : event,
  );
  assert.deepEqual(projectAgentStreamUsage(inputOnly).usage, {
    inputTokens: 10,
    outputTokens: 5,
  });
});

test("tool message explicitly linked to a step works regardless of event arrival order", () => {
  const events = stepEvents(0).map((event) => {
    if (!event.toolCallId) return event;
    const data = { ...(event.data as Record<string, unknown>) };
    delete data.model_step_id;
    return { ...event, data: data as AssessmentAgentStreamEvent["data"] };
  });
  assert.equal(
    projectAgentStreamUsage(events.reverse()).usage?.totalTokens,
    10000,
  );
});

test("sidebar current-run projection ignores previous-run controls and historical native turns", () => {
  const old = [0, 1, 2].flatMap((index) =>
    stepEvents(index, { data: { runtimeRunId: "native-old" } }),
  );
  const current = stepEvents(3, {
    runId: "run-2",
    data: { runtimeRunId: "native-current" },
  });
  const events = [...old, ...current];
  const staleControl = {
    state: C.completed,
    targetRunId: "native-old",
    requestId: null,
  };
  assert.equal(
    projectAssessmentRuntimeUsage(events, "run-2").usage?.totalTokens,
    12000,
  );
  assert.equal(
    projectAssessmentRuntimeUsage(events, "run-2", staleControl).usage
      ?.totalTokens,
    12000,
  );
  assert.equal(
    projectAssessmentRuntimeUsage(events, "run-1", staleControl).usage
      ?.totalTokens,
    20000,
  );
});

test("sidebar re-scopes a reused scan job to the newer Scanner generation despite old Interview controls", () => {
  const old = stepEvents(0, {
    stage: Stages.interview,
    data: { runtimeRunId: "native-old" },
  });
  const current = stepEvents(3, {
    stage: Stages.scanner,
    data: { runtimeRunId: "native-new" },
  });
  const staleControl = {
    state: C.completed,
    targetRunId: "native-old",
    requestId: null,
  };
  assert.equal(
    projectAssessmentRuntimeUsage([...old, ...current], "run-1", staleControl)
      .usage?.totalTokens,
    12000,
  );
});

test("exact tool call correlation survives an unrelated tool-result message identity", () => {
  const events = stepEvents(0).map((event) => {
    if (event.eventType !== T.semanticToolResult) return event;
    const data = { ...(event.data as Record<string, unknown>) };
    delete data.model_step_id;
    return {
      ...event,
      messageId: `result-${event.toolCallId}`,
      data: data as AssessmentAgentStreamEvent["data"],
    };
  });
  assert.equal(projectAgentStreamUsage(events).usage?.totalTokens, 10000);
  assert.equal(
    projectStreamRows(events).filter(
      (row) => row.kind === "tool" && row.usage?.totalTokens === 10000,
    ).length,
    2,
  );
});

test("collapsed groups, expanded occurrences and completed turn summary render exact usage", async () => {
  const React = await import("react");
  Object.defineProperty(globalThis, "React", {
    configurable: true,
    value: React,
  });
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { JSDOM } = await import("jsdom");
  const { AgentStreamTimeline } =
    await import("../src/features/workspace/components/molecules/agent-stream-timeline.tsx");
  const { AgentStreamTurn } =
    await import("../src/features/workspace/components/molecules/agent-stream-turn.tsx");
  const events = [0, 1, 2].flatMap((index) => stepEvents(index));
  const html = renderToStaticMarkup(
    React.createElement(AgentStreamTimeline, { events, embedded: true }),
  );
  const document = new JSDOM(html).window.document;
  const group = document.querySelector(
    '[data-stream-kind="tool"]:has([data-stream-repeat-count="3"])',
  )!;
  assert.match(group.lastElementChild?.textContent ?? "", /14k/);
  assert.equal(
    group.lastElementChild?.closest("details"),
    null,
    "group total visible while collapsed",
  );
  const occurrences = [...group.querySelectorAll("[data-stream-turn]")];
  assert.equal(occurrences.length, 3);
  assert.match(occurrences[0]?.lastElementChild?.textContent ?? "", /10k/);
  assert.match(occurrences[1]?.lastElementChild?.textContent ?? "", /10k/);
  assert.match(
    occurrences[1]?.lastElementChild?.textContent ?? "",
    /Shared|dùng chung/,
  );
  assert.match(occurrences[2]?.lastElementChild?.textContent ?? "", /4k/);
  const props = { stages: [], runId: "run-1", events, stageEvents: {} };
  const finished = new JSDOM(
    renderToStaticMarkup(React.createElement(AgentStreamTurn, props)),
  ).window.document;
  assert.equal(
    finished.querySelectorAll("[data-stream-usage-summary]").length,
    1,
  );
  assert.match(
    finished.querySelector("[data-stream-usage-total]")?.textContent ?? "",
    /20k/,
  );
  const running = new JSDOM(
    renderToStaticMarkup(
      React.createElement(AgentStreamTurn, {
        ...props,
        outcomeOverride: AGENT_STREAM_RUN_OUTCOMES.running,
      }),
    ),
  ).window.document;
  assert.equal(running.querySelector("[data-stream-usage-summary]"), null);
});
