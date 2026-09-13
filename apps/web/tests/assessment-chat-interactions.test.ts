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
  ASSESSMENT_RUNTIME_SUMMARY_MESSAGE_KEYS,
  ASSESSMENT_INTERVIEW_CONTROLS,
  ASSESSMENT_INTERVIEW_QUESTION_INTENTS,
} from "@lcsp/contracts/evidence";
import type { WorkspaceRuntimeActivityItem } from "../src/features/workspace/types/workspace-runtime.types";

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
Object.defineProperty(testWindow.HTMLTextAreaElement.prototype, "scrollHeight", {
  configurable: true,
  get() {
    return Math.max(1, this.value.split("\n").length) * 20;
  },
});

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const { createRoot } = await import("react-dom/client");
const { ChatSingleSelect } =
  await import("../src/features/workspace/components/molecules/chat-single-select");
const { InterviewAnswerHistory } =
  await import("../src/features/workspace/components/molecules/interview-answer-history");

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

test("assessment composer keeps five visible rows before showing resize", async () => {
  const { container, rerender } = await renderElement(
    React.createElement(AssessmentComposer, {
      value: "https://github.com/khovan123/LCSP",
      onValueChange: () => undefined,
      onSubmit: () => undefined,
    }),
  );
  const textarea = getTextarea(container);

  assert.equal(textarea.getAttribute("rows"), "5");
  const collapsedHeight = textarea.style.height;
  assert.ok(Number.parseInt(collapsedHeight, 10) >= 100);
  assert.equal(container.querySelector("button[aria-expanded]"), null);

  await rerender(
    React.createElement(AssessmentComposer, {
      value: "Line\n".repeat(6),
      onValueChange: () => undefined,
      onSubmit: () => undefined,
    }),
  );

  assert.equal(getTextarea(container).style.height, collapsedHeight);
  assert.ok(container.querySelector("button[aria-expanded]"));
});

test("runtime thinking activity resolves keyed summary without exposing raw payload", async () => {
  const activity: WorkspaceRuntimeActivityItem = {
    eventId: "evt-runtime-thinking",
    sequence: 7,
    emittedAt: "2026-09-11T12:00:13.000Z",
    assessmentId: "asm-runtime-thinking",
    runId: "scan-runtime-thinking",
    correlationId: "corr-runtime-thinking",
    eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
    runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.waiting,
    stage: ASSESSMENT_RUNTIME_STAGE_CODES.technicalEvidence,
    toolName: "engineering_rule_plan:eng-1",
    summary: ASSESSMENT_RUNTIME_SUMMARY_MESSAGE_KEYS.engineeringRulePlannerDecision,
    inputSummary: { hiddenPrompt: "must not render" },
    outputSummary: {
      messageKey:
        ASSESSMENT_RUNTIME_SUMMARY_MESSAGE_KEYS.engineeringRulePlannerDecision,
      messageParams: {
        decision: "SELECT",
        engineeringRuleId: "eng-1",
        reasonCode: "SOURCE_SCOPE_MATCH",
      },
      hiddenRationale: "must not render",
    },
    errorSummary: null,
    startedAt: null,
    completedAt: "2026-09-11T12:00:13.000Z",
    durationMs: 42,
    attempt: 1,
    waitingReason: null,
  };

  const { container } = await renderElement(
    React.createElement(RuntimeThinkingActivity, { activity }),
  );

  assert.match(container.textContent ?? "", /Tiến độ Planner/);
  assert.match(
    container.textContent ?? "",
    /Planner ghi nhận SELECT cho EngineeringRule eng-1/,
  );
  assert.doesNotMatch(
    container.textContent ?? "",
    new RegExp(ASSESSMENT_RUNTIME_SUMMARY_MESSAGE_KEYS.engineeringRulePlannerDecision),
  );
  assert.doesNotMatch(container.textContent ?? "", /hiddenPrompt/);
  assert.doesNotMatch(container.textContent ?? "", /hiddenRationale/);
  assert.equal(
    container.querySelector("[data-runtime-event-id]")?.getAttribute("data-runtime-event-id"),
    "evt-runtime-thinking",
  );
});



test("runtime thinking activity resolves summary key when output message key is absent", async () => {
  const activity: WorkspaceRuntimeActivityItem = {
    eventId: "evt-runtime-thinking-summary-key",
    sequence: 9,
    emittedAt: "2026-09-11T12:00:15.000Z",
    assessmentId: "asm-runtime-thinking",
    runId: "scan-runtime-thinking",
    correlationId: "corr-runtime-thinking",
    eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
    runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.waiting,
    stage: ASSESSMENT_RUNTIME_STAGE_CODES.technicalEvidence,
    toolName: "engineering_rule_plan:eng-1",
    summary: ASSESSMENT_RUNTIME_SUMMARY_MESSAGE_KEYS.engineeringRulePlannerDecision,
    inputSummary: null,
    outputSummary: {
      messageKey: "",
      messageParams: {
        decision: "SELECT",
        engineeringRuleId: "eng-1",
        reasonCode: "SOURCE_SCOPE_MATCH",
      },
    },
    errorSummary: null,
    startedAt: null,
    completedAt: "2026-09-11T12:00:15.000Z",
    durationMs: 42,
    attempt: 1,
    waitingReason: null,
  };

  const { container } = await renderElement(
    React.createElement(RuntimeThinkingActivity, { activity }),
  );

  assert.match(container.textContent ?? "", /Tiến độ Planner/);
  assert.match(
    container.textContent ?? "",
    /Planner ghi nhận SELECT cho EngineeringRule eng-1/,
  );
  assert.doesNotMatch(
    container.textContent ?? "",
    new RegExp(ASSESSMENT_RUNTIME_SUMMARY_MESSAGE_KEYS.engineeringRulePlannerDecision),
  );
});

test("runtime thinking activity falls back to legacy raw summary", async () => {
  const legacySummary = "Planner SELECT EngineeringRule eng-1 (SOURCE_SCOPE_MATCH)";
  const activity: WorkspaceRuntimeActivityItem = {
    eventId: "evt-runtime-thinking-legacy",
    sequence: 8,
    emittedAt: "2026-09-11T12:00:14.000Z",
    assessmentId: "asm-runtime-thinking",
    runId: "scan-runtime-thinking",
    correlationId: "corr-runtime-thinking",
    eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
    runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.waiting,
    stage: ASSESSMENT_RUNTIME_STAGE_CODES.technicalEvidence,
    toolName: "engineering_rule_plan:eng-1",
    summary: legacySummary,
    inputSummary: null,
    outputSummary: null,
    errorSummary: null,
    startedAt: null,
    completedAt: "2026-09-11T12:00:14.000Z",
    durationMs: 42,
    attempt: 1,
    waitingReason: null,
  };

  const { container } = await renderElement(
    React.createElement(RuntimeThinkingActivity, { activity }),
  );

  assert.match(container.textContent ?? "", /Tiến độ Planner/);
  assert.match(container.textContent ?? "", /Planner SELECT EngineeringRule eng-1/);
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
        React.createElement(InterviewAnswerHistory, {
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
      assert.ok(!container.textContent?.includes("Generic count summary"));
      if (comment) {
        assert.ok(container.textContent?.includes(comment));
      }
    });
  }
}
