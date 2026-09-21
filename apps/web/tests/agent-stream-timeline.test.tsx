import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  ASSESSMENT_AGENT_STREAM_DURABILITY,
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES,
  ASSESSMENT_AGENT_STREAM_SCHEMA_VERSIONS,
  ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  type AssessmentAgentStreamEvent,
} from "@lcsp/contracts/evidence";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});
for (const [key, value] of Object.entries({
  window: dom.window,
  self: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  React,
})) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
  });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
});

const { createRoot } = await import("react-dom/client");
const { AgentStreamTimeline } = await import(
  "../src/features/workspace/components/molecules/agent-stream-timeline.tsx"
);

const roots: ReturnType<typeof createRoot>[] = [];

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) {
      root.unmount();
    }
  });
  document.body.replaceChildren();
});

function event(
  sequence: number,
  eventType: AssessmentAgentStreamEvent["eventType"],
  data: AssessmentAgentStreamEvent["data"],
  overrides: Partial<AssessmentAgentStreamEvent> = {},
): AssessmentAgentStreamEvent {
  return {
    eventId: `event-${sequence}`,
    sequence,
    clientSequence: sequence,
    emittedAt: "2026-09-20T00:00:00.000Z",
    assessmentId: "assessment-1",
    runId: "run-1",
    correlationId: "corr-1",
    eventType,
    source: "engineering",
    agentName: "investigator",
    subagentName: null,
    namespace: ["node"],
    nodeName: "model",
    messageId: "m",
    toolName: "search_nodes",
    toolCallId: "call-1",
    status: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
    text: null,
    data,
    ...overrides,
  };
}

test("semantic agent stream rows render structured tool model and skill fields", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);

  await act(async () => {
    root.render(
      <AgentStreamTimeline
        events={[
          event(1, ASSESSMENT_AGENT_STREAM_EVENT_TYPES.semanticToolCall, {
            schemaVersion: ASSESSMENT_AGENT_STREAM_SCHEMA_VERSIONS.semanticV1,
            kind: ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.toolCall,
            durability: ASSESSMENT_AGENT_STREAM_DURABILITY.durable,
            toolName: "search_nodes",
            toolCallId: "call-1",
            parameters: {
              nodeType: "AI_MODEL_INVOCATION",
              limit: 7,
              api_key: "[REDACTED]",
            },
          }),
          event(2, ASSESSMENT_AGENT_STREAM_EVENT_TYPES.semanticToolResult, {
            schemaVersion: ASSESSMENT_AGENT_STREAM_SCHEMA_VERSIONS.semanticV1,
            kind: ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.toolResult,
            durability: ASSESSMENT_AGENT_STREAM_DURABILITY.durable,
            toolName: "search_nodes",
            toolCallId: "call-1",
            resultSummary: {
              count: 42,
              observationId: "obs-42",
            },
          }),
          event(
            3,
            ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelRequest,
            {
              schemaVersion: ASSESSMENT_AGENT_STREAM_SCHEMA_VERSIONS.semanticV1,
              kind: ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.modelRequest,
              durability: ASSESSMENT_AGENT_STREAM_DURABILITY.durable,
              provider: "openai",
              model: "gpt-5-test",
              goalSummary: "Execute node model",
              availableToolNames: ["search_nodes", "list_observations"],
              inputArtifactRefs: ["artifact:1"],
            },
            { toolName: null },
          ),
          event(
            4,
            ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelResult,
            {
              schemaVersion: ASSESSMENT_AGENT_STREAM_SCHEMA_VERSIONS.semanticV1,
              kind: ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.modelOutput,
              durability: ASSESSMENT_AGENT_STREAM_DURABILITY.durable,
              finishReason: "stop",
              usage: { input_tokens: 11, output_tokens: 13 },
              outputRefs: ["output:final"],
            },
            { toolName: null, status: ASSESSMENT_RUNTIME_RUN_STATUSES.completed },
          ),
          event(
            5,
            ASSESSMENT_AGENT_STREAM_EVENT_TYPES.skillUsage,
            {
              schemaVersion: ASSESSMENT_AGENT_STREAM_SCHEMA_VERSIONS.semanticV1,
              kind: ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.skillUsage,
              durability: ASSESSMENT_AGENT_STREAM_DURABILITY.durable,
              skillName: "lcsp",
              skillVersionOrHash: "sha256:abc123",
              promptVersion: "prompt/v1",
            },
            { toolName: null, status: ASSESSMENT_RUNTIME_RUN_STATUSES.completed },
          ),
        ]}
      />,
    );
  });

  const text = container.textContent ?? "";
  assert.match(text, /AI_MODEL_INVOCATION/);
  assert.match(text, /obs-42/);
  assert.match(text, /search_nodes, list_observations/);
  assert.match(text, /artifact:1/);
  assert.match(text, /output:final/);
  assert.match(text, /stop/);
  assert.match(text, /output_tokens/);
  assert.match(text, /sha256:abc123/);
  assert.match(text, /prompt\/v1/);
  assert.match(text, /\[REDACTED\]/);
});
