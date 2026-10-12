import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { JSDOM } from "jsdom";
import React, { act } from "react";
import { ASSESSMENT_RUNTIME_CONTROL_STATES as States } from "@lcsp/contracts/evidence";
import { resolveMessage } from "@lcsp/i18n";
import { appLocale } from "../src/lib/locale.ts";
import { selectAssessmentComposerRuntimeControl } from "../src/features/workspace/utils/assessment-composer-control.ts";

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
const { AssessmentComposer } =
  await import("../src/features/workspace/components/organisms/assessment-composer.tsx");

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

test("explicit acknowledged lifecycle renders Stop, Stopping, Continue, Continuing, Stop", () => {
  let stops = 0;
  let resumes = 0;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const steps = [
    [States.running, "pages.appShell.chatStopTurn", false],
    [States.stopRequested, "pages.appShell.chatStoppingTurn", true],
    [States.stopped, "pages.appShell.chatResumeTurn", false],
    [States.resumeRequested, "pages.appShell.chatContinuingTurn", true],
    [States.running, "pages.appShell.chatStopTurn", false],
  ] as const;
  for (const [state, key, disabled] of steps) {
    act(() =>
      root.render(
        <AssessmentComposer
          value=""
          onValueChange={() => {}}
          onSubmit={() => {}}
          runtimeControlState={state}
          onInterruptTurn={() => stops++}
          onResumeTurn={() => resumes++}
        />,
      ),
    );
    const label = resolveMessage(appLocale, key);
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.getAttribute("aria-label") === label,
    )!;
    assert.ok(button);
    assert.equal(button.disabled, disabled);
    assert.equal(
      button
        .querySelector("svg")
        ?.classList.contains(
          state === States.stopped
            ? "lucide-circle-play"
            : state === States.stopRequested || state === States.resumeRequested
              ? "lucide-circle-pause"
              : "lucide-circle-stop",
        ) ?? false,
      true,
    );
    assert.equal(button.textContent, "");
    if (state === States.stopRequested || state === States.resumeRequested) {
      assert.equal(container.querySelector("textarea")?.placeholder, label);
    }
    assert.equal(submitButton(container), null);
    act(() => button.click());
  }
  assert.equal(stops, 2);
  assert.equal(resumes, 1);
});

test("activity without canonical runtime state does not render a stop control", () => {
  let stopped = 0;
  let continued = 0;
  const control = selectAssessmentComposerRuntimeControl(null, null);
  const container = render(
    <AssessmentComposer
      value=""
      onValueChange={() => {}}
      onSubmit={() => {}}
      resumeAvailable
      onResume={() => continued++}
      runtimeControlState={control.state}
      onInterruptTurn={() => stopped++}
    />,
  );
  assert.equal(
    actionButton(container)?.getAttribute("aria-label") ?? null,
    null,
  );
  assert.equal(stopped, 0);
  assert.equal(continued, 0);
});

test("idle composer shows the plain send button", () => {
  const container = render(
    <AssessmentComposer
      value=""
      onValueChange={() => {}}
      onSubmit={() => {}}
    />,
  );

  assert.ok(submitButton(container));
});

test("a running turn replaces send with a stop button", () => {
  const container = render(
    <AssessmentComposer
      value=""
      onValueChange={() => {}}
      onSubmit={() => {}}
      runtimeControlState={States.running}
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
      runtimeControlState={States.running}
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
      runtimeControlState={States.running}
      onInterruptTurn={() => {}}
    />,
  );
  const stopAriaLabel =
    actionButton(runningContainer)?.getAttribute("aria-label");

  const pausedContainer = render(
    <AssessmentComposer
      value=""
      onValueChange={() => {}}
      onSubmit={() => {}}
      runtimeControlState={States.stopped}
      onResumeTurn={() => {}}
    />,
  );
  const playAriaLabel =
    actionButton(pausedContainer)?.getAttribute("aria-label");

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
      runtimeControlState={States.stopped}
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
        runtimeControlState={States.running}
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
        runtimeControlState={null}
      />,
    );
  });
  assert.ok(submitButton(container));
});
