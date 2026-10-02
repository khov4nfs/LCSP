import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { JSDOM } from "jsdom";
import React, { useState } from "react";
import { act } from "react";
import { ASSESSMENT_REPOSITORY_PROVIDERS } from "@lcsp/contracts/assessment";
import { deriveRepositorySetupAnswer } from "../src/features/assessment-flow/utils/repository-setup-history";
import type { Root } from "react-dom/client";
import {
  ASSESSMENT_RUNTIME_EVENT_TYPES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  ASSESSMENT_RUNTIME_STAGE_CODES,
  RULE_ANALYSIS_ACTIVITIES,
  RULE_ANALYSIS_SUMMARY_TOOL,
  ASSESSMENT_INTERVIEW_CONTROLS,
  ASSESSMENT_INTERVIEW_QUESTION_INTENTS,
} from "@lcsp/contracts/evidence";
import type { WorkspaceRuntimeActivityItem } from "../src/features/workspace/types/workspace-runtime.types";
import { projectRuntimeThinking } from "../src/features/workspace/utils/runtime-thinking-projection";
import { setAppLocale } from "../src/lib/locale";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});
const testWindow = dom.window;
Object.defineProperty(globalThis, "Element", {
  configurable: true,
  value: testWindow.Element,
});

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
Object.defineProperty(
  testWindow.HTMLTextAreaElement.prototype,
  "scrollHeight",
  {
    configurable: true,
    get() {
      // jsdom does not lay out Tailwind padding, so model the textarea's vertical
      // chrome explicitly to keep row-growth assertions aligned with browsers.
      return Math.max(1, this.value.split("\n").length) * 20 + 32;
    },
  },
);

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const { createRoot } = await import("react-dom/client");
const { ChatSingleSelect } =
  await import("../src/features/workspace/components/molecules/chat-single-select");
const { InterviewCycleTurn } =
  await import("../src/features/workspace/components/molecules/interview-cycle-turn");

const { SelectionHistoryRow } =
  await import("../src/features/workspace/components/molecules/selection-history-row");
const { AssessmentComposer } =
  await import("../src/features/workspace/components/organisms/assessment-composer");
const { InterviewAnswerMessage } =
  await import("../src/features/workspace/components/molecules/interview-answer-message");
const { RuntimeThinkingActivity } =
  await import("../src/features/workspace/components/molecules/runtime-thinking-activity");
const { AssessmentTranscript } =
  await import("../src/features/workspace/components/organisms/assessment-transcript");
const { RepositorySetupConversation } =
  await import("../src/features/assessment-flow/components/organisms/repository-setup-conversation");

const mountedRoots: Root[] = [];

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  testWindow.document.body.replaceChildren();
});

test("repository setup remains a read-only conversation after submission and remount", async () => {
  const provider = ASSESSMENT_REPOSITORY_PROVIDERS.gitlab;
  let selectedProvider: string | undefined;
  const { container, rerender } = await renderElement(
    React.createElement(RepositorySetupConversation, {
      onProviderChange: (value) => {
        selectedProvider = value;
      },
    }),
  );
  const prompt = container.querySelector(
    '[data-slot="agent-message"]',
  )?.textContent;
  await click(
    container.querySelector<HTMLButtonElement>(
      `[data-option-id="${provider}"]`,
    )!,
  );
  assert.equal(selectedProvider, provider);

  const persistedAnswer = deriveRepositorySetupAnswer({
    provider,
    repositoryFullName: "organization/subgroup/software",
  });
  assert.ok(persistedAnswer);
  assert.equal(
    persistedAnswer.repositoryUrl,
    "https://gitlab.com/organization/subgroup/software",
  );
  const history = React.createElement(RepositorySetupConversation, {
    ...persistedAnswer,
    disabled: true,
  });
  await rerender(history);

  for (const target of [container, (await renderElement(history)).container]) {
    assert.equal(
      target.querySelector('[data-slot="agent-message"]')?.textContent,
      prompt,
    );
    assert.equal(
      target.querySelector('[data-role="user"]')?.textContent,
      persistedAnswer.repositoryUrl,
    );
    const choices = [
      ...target.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    ];
    assert.equal(choices.length, 4);
    assert.ok(choices.every((choice) => choice.disabled));
    assert.equal(
      target
        .querySelector(`[data-option-id="${provider}"]`)
        ?.getAttribute("aria-checked"),
      "true",
    );
    await click(choices[0]);
    assert.equal(choices[0].getAttribute("aria-checked"), "false");
  }
});

test("repository history requires persisted identity and never guesses a provider", () => {
  assert.equal(deriveRepositorySetupAnswer(null), null);
  assert.equal(
    deriveRepositorySetupAnswer({
      provider: null,
      repositoryFullName: "acme/app",
    }),
    null,
  );
  assert.equal(
    deriveRepositorySetupAnswer({
      provider: ASSESSMENT_REPOSITORY_PROVIDERS.github,
      repositoryFullName: null,
    }),
    null,
  );
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

test("assessment composer swaps Resume back to Send after typing", async () => {
  let resumeCount = 0;
  let submitCount = 0;

  function ControlledComposer() {
    const [value, setValue] = useState("");
    return React.createElement(AssessmentComposer, {
      onResume: () => {
        resumeCount += 1;
      },
      onSubmit: () => {
        submitCount += 1;
      },
      onValueChange: setValue,
      placeholder: "Message",
      resumeAvailable: true,
      resumeLabel: "Resume",
      sendLabel: "Send",
      submitReady: value.trim().length > 0,
      value,
    });
  }

  const { container } = await renderElement(
    React.createElement(ControlledComposer),
  );

  const resumeButton = container.querySelector<HTMLButtonElement>(
    'button[type="button"][aria-label="Resume"]',
  );
  assert.ok(resumeButton);
  assert.equal(container.querySelector('button[type="submit"]'), null);

  await click(resumeButton);
  assert.equal(resumeCount, 1);
  assert.equal(submitCount, 0);

  await setTextareaValue(getTextarea(container), "More context");
  assert.equal(
    container.querySelector('button[type="button"][aria-label="Resume"]'),
    null,
  );
  const sendButton = getButton(container);
  assert.equal(sendButton.getAttribute("aria-label"), "Send");
  assert.equal(sendButton.disabled, false);
});

test("assessment composer grows from one to three rows before scrolling and offering expand", async () => {
  const { container, rerender } = await renderElement(
    React.createElement(AssessmentComposer, {
      value: "One line",
      onValueChange: () => undefined,
      onSubmit: () => undefined,
    }),
  );
  const textarea = getTextarea(container);

  assert.equal(textarea.getAttribute("rows"), "1");
  const oneRowHeight = Number.parseInt(textarea.style.height, 10);
  assert.ok(oneRowHeight > 0);
  assert.equal(textarea.style.overflowY, "hidden");
  assert.equal(container.querySelector("button[aria-expanded]"), null);

  await rerender(
    React.createElement(AssessmentComposer, {
      value: "One\nTwo\nThree",
      onValueChange: () => undefined,
      onSubmit: () => undefined,
    }),
  );
  const threeRowHeight = Number.parseInt(
    getTextarea(container).style.height,
    10,
  );
  assert.ok(threeRowHeight > oneRowHeight);
  assert.equal(getTextarea(container).style.overflowY, "hidden");
  assert.equal(container.querySelector("button[aria-expanded]"), null);

  await rerender(
    React.createElement(AssessmentComposer, {
      value: "One\nTwo\nThree\nFour",
      onValueChange: () => undefined,
      onSubmit: () => undefined,
    }),
  );
  const collapsed = getTextarea(container);
  assert.equal(Number.parseInt(collapsed.style.height, 10), threeRowHeight);
  assert.equal(collapsed.style.overflowY, "auto");
  const toggle = container.querySelector<HTMLButtonElement>(
    "button[aria-expanded]",
  );
  assert.ok(toggle);

  await click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.ok(
    Number.parseInt(getTextarea(container).style.height, 10) > threeRowHeight,
  );
  assert.equal(getTextarea(container).style.overflowY, "hidden");

  await rerender(
    React.createElement(AssessmentComposer, {
      value: "Line\n".repeat(30),
      onValueChange: () => undefined,
      onSubmit: () => undefined,
    }),
  );
  const expandedHeight = Number.parseInt(
    getTextarea(container).style.height,
    10,
  );
  assert.ok(expandedHeight > threeRowHeight);
  assert.ok(expandedHeight <= 352);
  assert.equal(getTextarea(container).style.overflowY, "auto");
});

function thinkingEvent(
  overrides: Partial<WorkspaceRuntimeActivityItem>,
): WorkspaceRuntimeActivityItem {
  return {
    eventId: "evt-runtime-thinking",
    sequence: 1,
    emittedAt: "2026-09-11T12:00:13.000Z",
    assessmentId: "asm-runtime-thinking",
    runId: "scan-runtime-thinking",
    correlationId: "corr-runtime-thinking",
    eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
    runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.waiting,
    stage: ASSESSMENT_RUNTIME_STAGE_CODES.technicalEvidence,
    toolName: "rule_analysis:eng-1",
    summary: "rule analysis progress",
    inputSummary: null,
    outputSummary: {
      activity: RULE_ANALYSIS_ACTIVITIES.ruleAnalysisCompleted,
    },
    errorSummary: null,
    startedAt: null,
    completedAt: "2026-09-11T12:00:13.000Z",
    durationMs: 42,
    attempt: 1,
    waitingReason: null,
    ...overrides,
  };
}

function thinkingSummaryEvent(
  overrides: Partial<WorkspaceRuntimeActivityItem> = {},
): WorkspaceRuntimeActivityItem {
  return thinkingEvent({
    eventId: "evt-rule-analysis-summary",
    toolName: RULE_ANALYSIS_SUMMARY_TOOL,
    outputSummary: {
      contextRevision: 3,
      engineeringRuleCount: 5,
      eligibleCount: 4,
    },
    ...overrides,
  });
}

test("runtime thinking renders aggregated rule-analysis progress without rule ids or activity codes", async () => {
  const [item] = projectRuntimeThinking([], [
    {
      assessmentId: "asm-runtime-thinking",
      runId: "scan-runtime-thinking",
      contextRevision: 3,
      engineeringRuleCount: 5,
      eligibleCount: 4,
      completed: 1,
      needsContext: 1,
      unresolved: 0,
      failed: 0,
    },
  ]);
  assert.ok(item);

  const { container } = await renderElement(
    React.createElement(RuntimeThinkingActivity, { item }),
  );

  const text = container.textContent ?? "";
  assert.match(text, /Yêu cầu đã phân tích: 1\/4 trong phạm vi/);
  for (const hidden of [
    "eng-1",
    "eng-2",
    "EngineeringRule",
    "RULE_ANALYSIS_COMPLETED",
    "rule_analysis:eng-1",
  ]) {
    assert.ok(!text.includes(hidden), `leaked ${hidden}`);
  }
  assert.equal(
    container
      .querySelector("[data-runtime-thinking-id]")
      ?.getAttribute("data-runtime-thinking-id"),
    "analysis:asm-runtime-thinking:scan-runtime-thinking",
  );
});

test("runtime thinking derives progress from the rule-analysis activity window", async () => {
  const items = projectRuntimeThinking([
    thinkingSummaryEvent({ sequence: 1 }),
    thinkingEvent({
      eventId: "evt-rule-1",
      sequence: 2,
      toolName: "rule_analysis:eng-1",
      outputSummary: {
        activity: RULE_ANALYSIS_ACTIVITIES.ruleAnalysisCompleted,
      },
    }),
    thinkingEvent({
      eventId: "evt-rule-2",
      sequence: 3,
      toolName: "rule_analysis:eng-2",
      outputSummary: {
        activity: RULE_ANALYSIS_ACTIVITIES.ruleAnalysisNeedsContext,
      },
    }),
  ]);
  assert.equal(items.length, 2);

  const { container } = await renderElement(
    React.createElement(RuntimeThinkingActivity, { item: items[0]! }),
  );

  const text = container.textContent ?? "";
  assert.match(text, /Yêu cầu đã phân tích: 1\/4 trong phạm vi/);
  assert.ok(!text.includes("eng-1"));
  assert.ok(!text.includes("eng-2"));
  assert.ok(!text.includes("RULE_ANALYSIS_NEEDS_CONTEXT"));
});

test("runtime thinking never renders raw rule ids or activity codes", async () => {
  const items = projectRuntimeThinking([
    thinkingSummaryEvent({ sequence: 1 }),
    thinkingEvent({
      eventId: "evt-rule-9",
      sequence: 2,
      toolName: "rule_analysis:eng-9",
      outputSummary: {
        activity: RULE_ANALYSIS_ACTIVITIES.ruleAnalysisFailed,
      },
    }),
  ]);
  assert.equal(items.length, 2);

  const { container } = await renderElement(
    React.createElement(RuntimeThinkingActivity, { item: items[0]! }),
  );

  const text = container.textContent ?? "";
  assert.match(text, /Yêu cầu đã phân tích: 0\/4 trong phạm vi/);
  for (const internal of ["eng-9", "RULE_ANALYSIS_FAILED"]) {
    assert.ok(!text.includes(internal), `leaked ${internal}`);
  }
});

test("composer expands and collapses without changing the draft or submitting", async () => {
  const draft = "A long answer\n".repeat(30);
  let submits = 0;
  const { container } = await renderElement(
    React.createElement(AssessmentComposer, {
      value: draft,
      onValueChange: () => undefined,
      onSubmit: () => {
        submits += 1;
      },
    }),
  );
  const toggle = container.querySelector<HTMLButtonElement>(
    "button[aria-expanded]",
  );
  assert.ok(toggle);
  await click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(getTextarea(container).value, draft);
  await keyDown(getTextarea(container), { key: "Escape" });
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(getTextarea(container).value, draft);
  assert.equal(submits, 0);
  assert.equal(container.querySelector("button button"), null);
});

test("long customer answers expand and collapse without losing text", async () => {
  const text = "Customer's original answer.\n".repeat(40);
  const { container } = await renderElement(
    React.createElement(InterviewAnswerMessage, { text }),
  );
  const toggle = container.querySelector<HTMLButtonElement>(
    "button[aria-expanded]",
  );
  assert.ok(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  await click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(container.querySelector("p")?.textContent, text);
  await click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
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

test("assessment transcript leaves short content at the top without synthetic bottom anchoring", async () => {
  // createElement's positional children do not satisfy a required `children` prop type.
  const transcriptProps: React.ComponentProps<typeof AssessmentTranscript> = {
    ariaLabel: "Transcript",
    children: React.createElement("p", null, "Short content"),
  };
  const { container } = await renderElement(
    React.createElement(AssessmentTranscript, transcriptProps),
  );

  const transcript = getTranscript(container);
  const rail = container.querySelector<HTMLElement>('[data-slot="chat-rail"]');
  assert.ok(rail);
  assert.match(transcript.className, /flex-col/);
  assert.match(rail.className, /shrink-0/);
  assert.match(rail.className, /pb-4/);
  assert.doesNotMatch(rail.className, /mt-auto/);
});

test("assessment transcript follows new output while pinned and offers a jump after scrolling up", async () => {
  const { container, rerender } = await renderElement(
    transcriptElement("Initial", 1),
  );
  const transcript = getTranscript(container);
  const scrollCalls: ScrollToOptions[] = [];
  const scrollState = setScrollState(transcript, scrollCalls);

  scrollState.top = 680;
  await act(async () => transcript.dispatchEvent(new Event("scroll", { bubbles: true })));
  await rerender(transcriptElement("Next", 2));
  assert.equal(scrollCalls.length, 1);
  assert.equal(scrollCalls[0].top, 1000);
  assert.equal(scrollCalls[0].behavior, "auto");

  scrollState.top = 100;
  await act(async () => transcript.dispatchEvent(new Event("scroll", { bubbles: true })));
  assert.equal(container.querySelector('[data-slot="transcript-jump-to-latest"]'), null);
  scrollState.height = 1200;
  await rerender(transcriptElement("Later", 3));
  assert.equal(scrollCalls.length, 1);
  assert.equal(scrollState.top, 100);
  const jump = container.querySelector<HTMLButtonElement>('[data-slot="transcript-jump-to-latest"]');
  assert.ok(jump);
  assert.equal(jump.getAttribute("aria-label"), "Đến hoạt động mới nhất");
  await click(jump);
  assert.equal(scrollCalls.at(-1)?.top, 1200);
  assert.equal(scrollState.top, 1200);
  assert.equal(container.querySelector('[data-slot="transcript-jump-to-latest"]'), null);

  scrollState.height = 1300;
  await rerender(transcriptElement("Newest", 4));
  assert.equal(scrollCalls.at(-1)?.top, 1300);
});

test("assessment transcript resize never pulls an unpinned reader to latest", async () => {
  const originalObserver = globalThis.ResizeObserver;
  let onResize: ResizeObserverCallback | undefined;
  class TestResizeObserver {
    constructor(callback: ResizeObserverCallback) { onResize = callback; }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = TestResizeObserver as typeof ResizeObserver;
  try {
    const { container } = await renderElement(transcriptElement("Initial", 1));
    const transcript = getTranscript(container);
    const scrollCalls: ScrollToOptions[] = [];
    const scrollState = setScrollState(transcript, scrollCalls);
    scrollState.top = 100;
    await act(async () => transcript.dispatchEvent(new Event("scroll", { bubbles: true })));
    scrollState.height = 1200;
    assert.ok(onResize);
    await act(async () => onResize!([], {} as ResizeObserver));
    assert.equal(scrollState.top, 100);
    assert.equal(scrollCalls.length, 0);
    assert.ok(container.querySelector('[data-slot="transcript-jump-to-latest"]'));

    scrollState.top = 850;
    await act(async () => transcript.dispatchEvent(new Event("scroll", { bubbles: true })));
    assert.equal(container.querySelector('[data-slot="transcript-jump-to-latest"]'), null);
    scrollState.height = 1400;
    await act(async () => onResize!([], {} as ResizeObserver));
    assert.equal(scrollCalls.at(-1)?.top, 1400);
  } finally {
    globalThis.ResizeObserver = originalObserver;
  }
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

async function setTextareaValue(element: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    testWindow.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  assert.ok(setter);
  await act(async () => {
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function getButton(container: HTMLElement) {
  const button = container.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  );
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

for (const control of [
  ASSESSMENT_INTERVIEW_CONTROLS.singleSelect,
  ASSESSMENT_INTERVIEW_CONTROLS.multiSelect,
  ASSESSMENT_INTERVIEW_CONTROLS.boolean,
]) {
  for (const comment of [
    undefined,
    "A mix of internal advice and external sharing.",
  ]) {
    test(`answered ${control} retains disabled choices and saved selection with comment=${Boolean(comment)}`, async () => {
      const { container } = await renderElement(
        React.createElement(InterviewCycleTurn, {
          answer: {
            questionId: "q-1",
            answeredAt: "2026-09-09T00:00:00Z",
            summary: "Generic count summary",
            comment,
            selectedChoiceIds: ["internal"],
            question: {
              id: "q-1",
              intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
              control,
              prompt: "How are results used?",
              choices: [
                { id: "internal", label: "Internal advice" },
                { id: "external", label: "External sharing" },
              ],
            },
          },
        }),
      );
      const options = Array.from(
        container.querySelectorAll<HTMLButtonElement>("button[aria-checked]"),
      );
      assert.equal(options.length, 2);
      assert.ok(options.every((option) => option.disabled));
      assert.deepEqual(
        options.map((option) => option.getAttribute("aria-checked")),
        ["true", "false"],
      );
      await act(async () => {
        options[1].click();
      });
      assert.deepEqual(
        options.map((option) => option.getAttribute("aria-checked")),
        ["true", "false"],
      );
      assert.equal(
        container.querySelector("time")?.getAttribute("datetime"),
        "2026-09-09T00:00:00Z",
      );
      assert.ok(!container.textContent?.includes("Generic count summary"));
      if (comment) {
        assert.ok(container.textContent?.includes(comment));
      }
    });
  }
}

test("confirmed interpretation history renders through the structured question turn and an output status card, not a raw internal status message", async () => {
  const answeredAt = "2026-09-14T08:14:05.968Z";
  const { container } = await renderElement(
    React.createElement(InterviewCycleTurn, {
      answer: {
        questionId: "q-confirm",
        answeredAt,
        summary: "Customer confirmed prior material context.",
        question: {
          id: "q-confirm",
          intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify,
          control: ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust,
          prompt: "Please confirm this interpretation.",
        },
      },
    }),
  );

  // The confirmation question renders through the structured
  // AssessmentQuestionTurn path, not as plain assistant paragraph text.
  const questionTurn = container.querySelector(
    '[data-slot="assessment-question-turn"]',
  );
  assert.ok(questionTurn);
  assert.match(
    questionTurn.textContent ?? "",
    /Please confirm this interpretation\./,
  );
  // A resolved (historical) confirmAdjust turn has nothing left to act on.
  assert.equal(
    questionTurn.querySelector('[data-slot="confirm-adjust-actions"]'),
    null,
  );

  const questionAgentTurn = questionTurn.closest('[data-slot="agent-turn"]');
  assert.equal(
    questionAgentTurn?.querySelector("time")?.getAttribute("datetime"),
    answeredAt,
  );

  const customerConfirm = container.querySelector(
    '[data-slot="interview-customer-confirmation"]',
  );
  assert.ok(customerConfirm);
  assert.equal(
    customerConfirm
      .closest('[data-slot="agent-turn"]')
      ?.getAttribute("data-role"),
    "user",
  );

  // The internal status ("Customer confirmed prior material context.") is
  // never rendered verbatim as a standalone chat message — it surfaces as a
  // distinct output card instead.
  const outputPanel = container.querySelector(
    '[data-slot="interview-output-panel"]',
  );
  assert.ok(outputPanel);
  assert.doesNotMatch(
    container.textContent ?? "",
    /Customer confirmed prior material context\./,
  );
});

test('adjusted interpretation history shows the customer\'s own adjustment before the "context updated" output panel', async () => {
  const answeredAt = "2026-09-14T08:20:00.000Z";
  const { container } = await renderElement(
    React.createElement(InterviewCycleTurn, {
      answer: {
        questionId: "q-adjust",
        answeredAt,
        summary: "Customer requested adjustment to prior material context.",
        comment:
          "Payment overrides require three-party authorization in production.",
        question: {
          id: "q-adjust",
          intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify,
          control: ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust,
          prompt: "Please confirm this interpretation.",
        },
      },
    }),
  );

  const questionTurn = container.querySelector(
    '[data-slot="assessment-question-turn"]',
  );
  const comment = [...container.querySelectorAll("p")].find((node) =>
    node.textContent?.includes(
      "Payment overrides require three-party authorization in production.",
    ),
  );
  const outputPanel = container.querySelector(
    '[data-slot="interview-output-panel"]',
  );
  assert.ok(questionTurn && comment && outputPanel);
  assert.ok(
    questionTurn.compareDocumentPosition(comment) &
      Node.DOCUMENT_POSITION_FOLLOWING,
    "the question must come before the customer's adjustment",
  );
  assert.ok(
    comment.compareDocumentPosition(outputPanel) &
      Node.DOCUMENT_POSITION_FOLLOWING,
    'the customer\'s adjustment must come before the "context updated" output panel',
  );
  assert.doesNotMatch(
    container.textContent ?? "",
    /Customer requested adjustment to prior material context\./,
  );
});

test("historical free-text questions render as agent turns with timestamp", async () => {
  const answeredAt = "2026-09-14T08:12:31.000Z";
  const { container } = await renderElement(
    React.createElement(InterviewCycleTurn, {
      answer: {
        questionId: "q-free-text",
        answeredAt,
        questionPrompt: "How is operational review performed?",
        summary: "Human compliance reviewers check every report.",
      },
    }),
  );

  const turns = Array.from(
    container.querySelectorAll<HTMLElement>('[data-slot="agent-turn"]'),
  );
  const questionTurn = turns.find((turn) =>
    turn.textContent?.includes("How is operational review performed?"),
  );
  assert.ok(questionTurn);
  assert.equal(questionTurn.dataset.role, "agent");
  assert.equal(
    questionTurn.querySelector("time")?.getAttribute("datetime"),
    answeredAt,
  );
});

test("turn timestamps render through the active locale instead of raw ISO", async () => {
  const answeredAt = "2026-09-14T08:13:57.315Z";
  for (const locale of ["vi", "en"] as const) {
    setAppLocale(locale);
    const { container } = await renderElement(
      React.createElement(InterviewCycleTurn, {
        answer: {
          questionId: `q-locale-${locale}`,
          answeredAt,
          questionPrompt: "When was this turn created?",
          summary: "Locale timestamp check.",
        },
      }),
    );

    const time = container.querySelector("time");
    assert.equal(time?.getAttribute("datetime"), answeredAt);
    assert.equal(
      time?.textContent,
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(answeredAt)),
    );
    assert.notEqual(time?.textContent, answeredAt);
    assert.ok(!time?.textContent?.includes("T"));
    assert.ok(!time?.textContent?.includes("Z"));
  }
  setAppLocale("vi");
});
