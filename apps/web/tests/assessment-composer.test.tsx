import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

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
const { AssessmentComposer } = await import(
  "../src/features/workspace/components/organisms/assessment-composer.tsx"
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

function render(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(node);
  });
  return container;
}

function submitButton(container: HTMLElement) {
  return container.querySelector('button[type="submit"]');
}

function actionButton(container: HTMLElement) {
  return container.querySelector('button[type="button"]:last-of-type');
}

test("idle composer shows the plain send button", () => {
  const container = render(
    <AssessmentComposer value="" onValueChange={() => {}} onSubmit={() => {}} />,
  );

  assert.ok(submitButton(container));
});

test("a running turn replaces send with a stop button", () => {
  const container = render(
    <AssessmentComposer
      value=""
      onValueChange={() => {}}
      onSubmit={() => {}}
      turnRunning
      onInterruptTurn={() => {}}
    />,
  );

  assert.equal(submitButton(container), null);
  const button = actionButton(container);
  assert.ok(button);
  assert.equal(button?.getAttribute("type"), "button");
});

test("clicking the stop button calls onInterruptTurn, not onSubmit", () => {
  let interrupted = 0;
  let submitted = 0;
  const container = render(
    <AssessmentComposer
      value=""
      onValueChange={() => {}}
      onSubmit={() => submitted++}
      turnRunning
      onInterruptTurn={() => interrupted++}
    />,
  );

  const button = actionButton(container) as HTMLButtonElement;
  act(() => {
    button.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  });

  assert.equal(interrupted, 1);
  assert.equal(submitted, 0);
});

test("a paused turn shows a play-style button distinct from the stop button", () => {
  const runningContainer = render(
    <AssessmentComposer
      value=""
      onValueChange={() => {}}
      onSubmit={() => {}}
      turnRunning
      onInterruptTurn={() => {}}
    />,
  );
  const stopAriaLabel = actionButton(runningContainer)?.getAttribute(
    "aria-label",
  );

  const pausedContainer = render(
    <AssessmentComposer
      value=""
      onValueChange={() => {}}
      onSubmit={() => {}}
      turnPaused
      onResumeTurn={() => {}}
    />,
  );
  const playAriaLabel = actionButton(pausedContainer)?.getAttribute(
    "aria-label",
  );

  assert.ok(stopAriaLabel);
  assert.ok(playAriaLabel);
  assert.notEqual(stopAriaLabel, playAriaLabel);
});

test("clicking the play button calls onResumeTurn", () => {
  let resumed = 0;
  const container = render(
    <AssessmentComposer
      value=""
      onValueChange={() => {}}
      onSubmit={() => {}}
      turnPaused
      onResumeTurn={() => resumed++}
    />,
  );

  const button = actionButton(container) as HTMLButtonElement;
  act(() => {
    button.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  });

  assert.equal(resumed, 1);
});

test("once the turn ends, the composer reverts to the plain send button", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);

  act(() => {
    root.render(
      <AssessmentComposer
        value=""
        onValueChange={() => {}}
        onSubmit={() => {}}
        turnRunning
        onInterruptTurn={() => {}}
      />,
    );
  });
  assert.equal(submitButton(container), null);

  act(() => {
    root.render(
      <AssessmentComposer
        value=""
        onValueChange={() => {}}
        onSubmit={() => {}}
        turnRunning={false}
        turnPaused={false}
      />,
    );
  });
  assert.ok(submitButton(container));
});
