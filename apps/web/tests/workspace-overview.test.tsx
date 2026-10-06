import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
  ASSESSMENT_STATUS_CODES,
} from "@lcsp/contracts/assessment";
import type { CanonicalAssessmentRuntimeSnapshot } from "@lcsp/contracts/evidence";
import { JSDOM } from "jsdom";
import React, { act } from "react";

type NonBlockedLifecycleState = Exclude<
  (typeof ASSESSMENT_LIFECYCLE_STATES)[keyof typeof ASSESSMENT_LIFECYCLE_STATES],
  typeof ASSESSMENT_LIFECYCLE_STATES.BLOCKED
>;

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
const { WorkspaceOverview } =
  await import("../src/features/workspace/components/organisms/workspace-overview.tsx");

const roots: ReturnType<typeof createRoot>[] = [];

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) {
      root.unmount();
    }
  });
  document.body.replaceChildren();
});

function canonicalAssessment(
  assessmentId: string,
  state: NonBlockedLifecycleState,
): CanonicalAssessmentRuntimeSnapshot {
  return {
    assessmentId,
    lifecycle: {
      state,
      assessmentRevision: 7,
    },
    runtime: {
      threadId: "00000000-0000-4000-8000-000000000001",
      rootAgentVersion: "w1-4-test",
      checkpointNamespace: "00000000-0000-4000-8000-000000000002",
      checkpointId: null,
      currentExecutionId: "00000000-0000-4000-8000-000000000003",
      executionState: AGENT_EXECUTION_STATES.PAUSED,
      eventSequence: 7,
      startedAt: "2026-10-06T00:00:00.000Z",
      lastResumedAt: null,
      updatedAt: "2026-10-06T00:00:00.000Z",
    },
  };
}

test("needs-follow-up counts only complete canonical lifecycle/runtime pairs", () => {
  const assessments = [
    {
      id: "00000000-0000-4000-8000-000000000011",
      name: "Paused assessment",
      status: ASSESSMENT_STATUS_CODES.scanInProgress,
      created_at: "2026-10-06T00:00:00.000Z",
    },
    {
      id: "00000000-0000-4000-8000-000000000012",
      name: "Unavailable assessment",
      status: ASSESSMENT_STATUS_CODES.scanInProgress,
      created_at: "2026-10-05T00:00:00.000Z",
    },
    {
      id: "00000000-0000-4000-8000-000000000013",
      name: "Complete assessment",
      status: ASSESSMENT_STATUS_CODES.readyForReview,
      created_at: "2026-10-04T00:00:00.000Z",
    },
  ];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);

  act(() => {
    root.render(
      <WorkspaceOverview
        assessments={assessments}
        canonicalAssessments={{
          [assessments[0].id]: canonicalAssessment(
            assessments[0].id,
            ASSESSMENT_LIFECYCLE_STATES.PAUSED,
          ),
          [assessments[1].id]: {
            assessmentId: assessments[1].id,
            lifecycle: null,
            runtime: null,
          },
          [assessments[2].id]: canonicalAssessment(
            assessments[2].id,
            ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
          ),
        }}
        connectionState="CONNECTED"
      />,
    );
  });

  const metricTitles = Array.from(
    container
      .querySelector("section")
      ?.querySelectorAll('[data-slot="card-title"]') ?? [],
  ).map((node) => node.textContent);
  assert.deepEqual(metricTitles, ["3", "1", "1"]);
});
