import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  AGENT_STREAM_BOUNDARY_TYPES,
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES as T,
  type AssessmentAgentStreamEvent,
} from "@lcsp/contracts/evidence";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import type { Root } from "react-dom/client";
import { PREPARATION_ACTIVITY_VISIBLE_LIMIT } from "../src/features/admin/config/preparation-activity.config";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});
const testWindow = dom.window;
for (const [name, value] of Object.entries({
  window: testWindow,
  document: testWindow.document,
  navigator: testWindow.navigator,
  Element: testWindow.Element,
  HTMLElement: testWindow.HTMLElement,
  MouseEvent: testWindow.MouseEvent,
  Event: testWindow.Event,
  Node: testWindow.Node,
})) {
  Object.defineProperty(globalThis, name, { configurable: true, value });
}
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { createRoot } = await import("react-dom/client");
const { RuleSetPreparationActivity } =
  await import("../src/features/admin/components/molecules/rule-set-preparation-activity");
const roots: Root[] = [];

function event(
  sequence: number,
  eventType: AssessmentAgentStreamEvent["eventType"],
  overrides: Partial<AssessmentAgentStreamEvent> = {},
): AssessmentAgentStreamEvent {
  return {
    eventId: `event-${sequence}`,
    sequence,
    clientSequence: sequence,
    emittedAt: new Date(Date.UTC(2026, 9, 13, 0, 0, sequence)).toISOString(),
    assessmentId: null,
    boundaryType: AGENT_STREAM_BOUNDARY_TYPES.ruleSetPreparation,
    boundaryId: "preparation-1",
    preparationRunId: "preparation-1",
    runId: "preparation-1",
    correlationId: "correlation-1",
    eventType,
    source: null,
    agentName: "rule-set-preparation",
    subagentName: null,
    namespace: [],
    nodeName: null,
    messageId: null,
    toolName: null,
    toolCallId: null,
    status: "RUNNING",
    text: null,
    data: null,
    ...overrides,
  };
}

function render(events: AssessmentAgentStreamEvent[]) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const renderActivity = (nextEvents: AssessmentAgentStreamEvent[]) =>
    act(() => {
      root.render(
        React.createElement(RuleSetPreparationActivity, {
          events: nextEvents,
          terminal: false,
          executionState: null,
          connected: true,
        }),
      );
    });
  renderActivity(events);
  return { container, renderActivity };
}

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

test("long Preparation displays recent activity without rendering an unbounded journal", () => {
  const events = Array.from(
    { length: PREPARATION_ACTIVITY_VISIBLE_LIMIT + 1 },
    (_, i) =>
      event(i + 1, T.modelCallCompleted, {
        status: "COMPLETED",
        data: { model_step_id: `step-${i}`, usage: { total_tokens: 5 } },
      }),
  );
  const { container } = render(events);
  assert.equal(
    container.querySelectorAll('[data-slot="work-disclosure"]').length,
    PREPARATION_ACTIVITY_VISIBLE_LIMIT,
  );
  assert.match(container.textContent ?? "", /Tổng token của hoạt động đã tải/);
  assert.match(container.textContent ?? "", /505/);
});

test("Preparation activities start collapsed and keep user expansion across stream updates", () => {
  const initial = [event(1, T.boundaryStarted)];
  const { container, renderActivity } = render(initial);
  const disclosures = () => [
    ...container.querySelectorAll<HTMLDetailsElement>(
      '[data-slot="work-disclosure"]',
    ),
  ];
  const first = disclosures()[0]!;
  const firstSummary = first.querySelector("summary")!;

  assert.equal(first.open, false);
  assert.equal(firstSummary.getAttribute("aria-expanded"), "false");
  assert.match(firstSummary.textContent ?? "", /Đã bắt đầu chuẩn bị/);

  act(() => {
    first.open = true;
    first.dispatchEvent(new Event("toggle"));
  });
  assert.equal(firstSummary.getAttribute("aria-expanded"), "true");

  renderActivity([
    ...initial,
    event(2, T.semanticToolCall, {
      toolName: "task",
      toolCallId: "reader-1",
      data: { native_tool: "task", subagent_type: "legal-source-reader" },
    }),
  ]);

  assert.equal(disclosures()[0]?.open, true);
  assert.equal(disclosures()[1]?.open, false);
});

test("article files expose committed and rejection counts through the disclosure", () => {
  const data = JSON.parse(
    readFileSync(
      new URL(
        "../src/public/assets/mocks/admin/claim-file-activity.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const { container } = render([event(1, T.customProgress, { data })]);
  const summary = container.querySelector("summary")!;
  assert.match(
    summary.textContent ?? "",
    /Đã lưu tệp Điều: luat-134\/dieu-5.json/u,
  );
  const details = container.querySelector<HTMLDetailsElement>("details")!;
  act(() => {
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
  assert.match(container.textContent ?? "", /Đơn vị nguồn đã lưu2/u);
  assert.match(container.textContent ?? "", /Mục bị từ chối1/u);
});
