import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { JSDOM } from "jsdom";
import React, { useState } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});
const testWindow = dom.window;

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: testWindow,
});
Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: testWindow.document,
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: testWindow.navigator,
});
Object.defineProperty(globalThis, "HTMLElement", {
  configurable: true,
  value: testWindow.HTMLElement,
});
Object.defineProperty(globalThis, "HTMLButtonElement", {
  configurable: true,
  value: testWindow.HTMLButtonElement,
});
Object.defineProperty(globalThis, "HTMLFormElement", {
  configurable: true,
  value: testWindow.HTMLFormElement,
});
Object.defineProperty(globalThis, "KeyboardEvent", {
  configurable: true,
  value: testWindow.KeyboardEvent,
});
Object.defineProperty(globalThis, "MouseEvent", {
  configurable: true,
  value: testWindow.MouseEvent,
});
Object.defineProperty(globalThis, "Event", {
  configurable: true,
  value: testWindow.Event,
});
Object.defineProperty(globalThis, "Node", {
  configurable: true,
  value: testWindow.Node,
});
Object.defineProperty(globalThis, "React", {
  configurable: true,
  value: React,
});
Object.defineProperty(testWindow, "matchMedia", {
  configurable: true,
  value: () => ({
    addEventListener: () => undefined,
    addListener: () => undefined,
    dispatchEvent: () => false,
    matches: false,
    media: "",
    onchange: null,
    removeEventListener: () => undefined,
    removeListener: () => undefined,
  }),
});
Object.defineProperty(testWindow.HTMLElement.prototype, "scrollTo", {
  configurable: true,
  value: () => undefined,
});

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const { createRoot } = await import("react-dom/client");
const { ChatSingleSelect } =
  await import("../src/features/workspace/components/molecules/chat-single-select");
const { SelectionHistoryRow } =
  await import("../src/features/workspace/components/molecules/selection-history-row");
const { AssessmentComposer } =
  await import("../src/features/workspace/components/organisms/assessment-composer");
const { AssessmentTranscript } =
  await import("../src/features/workspace/components/organisms/assessment-transcript");

const mountedRoots: Root[] = [];

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  testWindow.document.body.replaceChildren();
});

test("assessment composer submits through Send click and Enter key", async () => {
  let submitCount = 0;
  const { container } = await renderElement(
    React.createElement(AssessmentComposer, {
      onSubmit: () => {
        submitCount += 1;
      },
      onValueChange: () => undefined,
      placeholder: "Message",
      sendLabel: "Send",
      value: "Run assessment",
    }),
  );

  await click(getButton(container));
  assert.equal(submitCount, 1);

  await keyDown(getTextarea(container), { key: "Enter" });
  assert.equal(submitCount, 2);
});

test("assessment composer blocks empty disabled submitting and multiline submits", async () => {
  const cases = [
    { value: "" },
    { disabled: true, value: "Run assessment" },
    { submitting: true, value: "Run assessment" },
  ];

  for (const props of cases) {
    let submitCount = 0;
    const { container } = await renderElement(
      React.createElement(AssessmentComposer, {
        ...props,
        onSubmit: () => {
          submitCount += 1;
        },
        onValueChange: () => undefined,
        placeholder: "Message",
        sendLabel: "Send",
      }),
    );

    await click(getButton(container));
    await keyDown(getTextarea(container), { key: "Enter" });
    assert.equal(submitCount, 0);
  }

  let submitCount = 0;
  const { container } = await renderElement(
    React.createElement(AssessmentComposer, {
      onSubmit: () => {
        submitCount += 1;
      },
      onValueChange: () => undefined,
      placeholder: "Message",
      sendLabel: "Send",
      value: "Run assessment",
    }),
  );

  await keyDown(getTextarea(container), { key: "Enter", shiftKey: true });
  await keyDown(getTextarea(container), { isComposing: true, key: "Enter" });
  assert.equal(submitCount, 0);
});

test("chat single select changes by click and ignores disabled options", async () => {
  const changes: string[] = [];
  const { container } = await renderElement(
    React.createElement(ControlledSingleSelect, {
      changes,
      initialValue: "github",
    }),
  );
  const radios = getRadios(container);

  await click(radios[2]);
  assert.equal(changes.at(-1), "bitbucket");
  assert.equal(getRadios(container)[2].getAttribute("aria-checked"), "true");

  await click(getRadios(container)[1]);
  assert.equal(changes.at(-1), "bitbucket");
  assert.equal(getRadios(container)[1].getAttribute("aria-checked"), "false");
});

test("chat single select keyboard navigation selects and focuses enabled radios", async () => {
  const changes: string[] = [];
  const { container } = await renderElement(
    React.createElement(ControlledSingleSelect, {
      changes,
      initialValue: "github",
    }),
  );

  getRadios(container)[0].focus();
  await keyDown(getRadios(container)[0], { key: "ArrowDown" });
  assert.equal(changes.at(-1), "bitbucket");
  assert.equal(getRadios(container)[2].getAttribute("aria-checked"), "true");
  assert.equal(testWindow.document.activeElement, getRadios(container)[2]);

  await keyDown(getRadios(container)[2], { key: "ArrowUp" });
  assert.equal(changes.at(-1), "github");
  assert.equal(testWindow.document.activeElement, getRadios(container)[0]);

  await keyDown(getRadios(container)[0], { key: "End" });
  assert.equal(changes.at(-1), "bitbucket");
  assert.equal(testWindow.document.activeElement, getRadios(container)[2]);

  await keyDown(getRadios(container)[2], { key: "Home" });
  assert.equal(changes.at(-1), "github");
  assert.equal(testWindow.document.activeElement, getRadios(container)[0]);
});

test("assessment transcript follows latest output only while reader is near bottom", async () => {
  const { container, rerender } = await renderElement(
    transcriptElement("Initial", 1),
  );
  const transcript = getTranscript(container);
  const scrollCalls: ScrollToOptions[] = [];
  const scrollState = setScrollState(transcript, scrollCalls);

  scrollState.top = 680;
  await rerender(transcriptElement("Next", 2));
  assert.equal(scrollCalls.length, 1);
  assert.equal(scrollCalls[0].top, 1000);
  assert.equal(scrollCalls[0].behavior, "smooth");

  scrollState.top = 100;
  transcript.dispatchEvent(new Event("scroll", { bubbles: true }));
  scrollState.height = 1200;
  await rerender(transcriptElement("Later", 3));
  assert.equal(scrollCalls.length, 1);
});

test("selection history row keeps completed value visible and non-interactive", async () => {
  const { container } = await renderElement(
    React.createElement(SelectionHistoryRow, {
      detail: "payment-service",
      prompt: "Connected",
      selectedValue: "GitHub",
    }),
  );

  assert.match(container.textContent ?? "", /Connected/);
  assert.match(container.textContent ?? "", /GitHub/);
  assert.match(container.textContent ?? "", /payment-service/);
  assert.equal(
    container.querySelector("button,input,select,textarea,[role='radio']"),
    null,
  );
});

function ControlledSingleSelect({
  changes,
  initialValue,
}: {
  changes: string[];
  initialValue: string;
}) {
  const [value, setValue] = useState(initialValue);

  return React.createElement(ChatSingleSelect, {
    ariaLabel: "Repository provider",
    onValueChange: (nextValue) => {
      changes.push(nextValue);
      setValue(nextValue);
    },
    options: [
      { id: "github", label: "GitHub" },
      { disabled: true, id: "gitlab", label: "GitLab" },
      { id: "bitbucket", label: "Bitbucket" },
    ],
    value,
  });
}

async function renderElement(element: React.ReactElement) {
  const container = testWindow.document.createElement("div");
  testWindow.document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push(root);

  await act(async () => {
    root.render(element);
  });

  return {
    container,
    rerender: async (nextElement: React.ReactElement) => {
      await act(async () => {
        root.render(nextElement);
      });
    },
  };
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
}

async function keyDown(
  element: HTMLElement,
  init: KeyboardEventInit & { isComposing?: boolean },
) {
  await act(async () => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });
}

function getButton(container: HTMLElement) {
  const button = container.querySelector("button");
  assert.ok(button);
  return button;
}

function getTextarea(container: HTMLElement) {
  const textarea = container.querySelector("textarea");
  assert.ok(textarea);
  return textarea;
}

function getRadios(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>("[role='radio']"),
  );
}

function getTranscript(container: HTMLElement) {
  const transcript = container.querySelector<HTMLElement>("[role='log']");
  assert.ok(transcript);
  return transcript;
}

function transcriptElement(label: string, autoScrollKey: number) {
  const TranscriptComponent = AssessmentTranscript as React.ComponentType<{
    ariaLabel: string;
    autoScrollKey: number;
    children?: React.ReactNode;
  }>;

  return React.createElement(
    TranscriptComponent,
    { ariaLabel: "Transcript", autoScrollKey },
    React.createElement("p", null, label),
  );
}

function setScrollState(element: HTMLElement, scrollCalls: ScrollToOptions[]) {
  const state = {
    height: 1000,
    top: 0,
  };

  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    get: () => 300,
  });
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    get: () => state.height,
  });
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get: () => state.top,
    set: (value: number) => {
      state.top = value;
    },
  });
  Object.defineProperty(element, "scrollTo", {
    configurable: true,
    value: (options: ScrollToOptions) => {
      scrollCalls.push(options);
      state.top = Number(options.top ?? state.top);
    },
  });

  return state;
}
