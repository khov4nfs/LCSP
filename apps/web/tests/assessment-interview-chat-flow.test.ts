import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS,
  ASSESSMENT_INTERVIEW_CONTROLS,
  ASSESSMENT_INTERVIEW_QUESTION_INTENTS,
  type AssessmentInterviewQuestion,
} from "@lcsp/contracts/evidence";
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
Object.defineProperty(globalThis, "HTMLTextAreaElement", {
  configurable: true,
  value: testWindow.HTMLTextAreaElement,
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

if (!testWindow.HTMLFormElement.prototype.requestSubmit) {
  testWindow.HTMLFormElement.prototype.requestSubmit = function (submitter) {
    if (submitter) {
      submitter.click();
    } else {
      const submitEvent = new testWindow.Event("submit", {
        bubbles: true,
        cancelable: true,
      });
      this.dispatchEvent(submitEvent);
    }
  };
}

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const { createRoot } = await import("react-dom/client");
const { AssessmentQuestionTurn } =
  await import("../src/features/workspace/components/molecules/assessment-question-turn");
const { AssessmentComposer } =
  await import("../src/features/workspace/components/organisms/assessment-composer");

const mountedRoots: Root[] = [];

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  testWindow.document.body.replaceChildren();
});

type InteractiveHarnessProps = {
  question: AssessmentInterviewQuestion;
  onSubmit: (payload: unknown) => void;
  disabled?: boolean;
};

function InterviewInteractiveHarness({
  question,
  onSubmit,
  disabled = false,
}: InteractiveHarnessProps) {
  const [selectedChoiceIds, setSelectedChoiceIds] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const [otherText, setOtherText] = useState("");
  const [isAdjusting, setIsAdjusting] = useState(false);

  const selectedChoiceRequiresFreeText = (question.choices ?? []).some(
    (c) => c.requiresFreeText && selectedChoiceIds.includes(c.id),
  );

  let isSubmitReady = false;
  if (!disabled) {
    if (question.control === ASSESSMENT_INTERVIEW_CONTROLS.freeText) {
      isSubmitReady = freeText.trim().length > 0;
    } else if (
      question.control === ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust
    ) {
      isSubmitReady = isAdjusting && freeText.trim().length > 0;
    } else if (
      question.control === ASSESSMENT_INTERVIEW_CONTROLS.singleSelect ||
      question.control === ASSESSMENT_INTERVIEW_CONTROLS.boolean
    ) {
      if (selectedChoiceIds.length === 1) {
        isSubmitReady = selectedChoiceRequiresFreeText
          ? otherText.trim().length > 0
          : true;
      }
    } else if (question.control === ASSESSMENT_INTERVIEW_CONTROLS.multiSelect) {
      if (selectedChoiceIds.length > 0) {
        isSubmitReady = selectedChoiceRequiresFreeText
          ? otherText.trim().length > 0
          : true;
      }
    }
  }

  function handleSubmit() {
    if (!isSubmitReady) {
      return;
    }
    if (question.control === ASSESSMENT_INTERVIEW_CONTROLS.freeText) {
      onSubmit({ questionId: question.id, freeText: freeText.trim() });
    } else if (
      question.control === ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust
    ) {
      onSubmit({
        questionId: question.id,
        adjusted: true,
        freeText: freeText.trim(),
      });
    } else if (
      question.control === ASSESSMENT_INTERVIEW_CONTROLS.singleSelect ||
      question.control === ASSESSMENT_INTERVIEW_CONTROLS.boolean ||
      question.control === ASSESSMENT_INTERVIEW_CONTROLS.multiSelect
    ) {
      const payload: Record<string, unknown> = {
        questionId: question.id,
        selectedChoiceIds,
      };
      if (selectedChoiceRequiresFreeText) {
        payload.otherText = otherText.trim();
      }
      onSubmit(payload);
    }
  }

  const isComposerDisabled =
    disabled ||
    (question.control === ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust &&
      !isAdjusting);

  const composerValue = selectedChoiceRequiresFreeText ? otherText : freeText;
  const onComposerChange = selectedChoiceRequiresFreeText
    ? setOtherText
    : setFreeText;

  return React.createElement(
    "div",
    null,
    React.createElement(AssessmentQuestionTurn, {
      disabled,
      isAdjusting,
      onAdjust: () => setIsAdjusting(true),
      onSubmitAnswer: onSubmit,
      onSelectedChoiceIdsChange: setSelectedChoiceIds,
      question,
      selectedChoiceIds,
    }),
    React.createElement(AssessmentComposer, {
      disabled: isComposerDisabled,
      onSubmit: handleSubmit,
      onValueChange: onComposerChange,
      submitReady: isSubmitReady,
      value: composerValue,
    }),
  );
}

test("FREE_TEXT: renders question without inline textarea, uses shared composer for Enter and Send submission", async () => {
  const submissions: unknown[] = [];
  const question: AssessmentInterviewQuestion = {
    control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
    id: "q-free-1",
    intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
    prompt: "Describe this system architecture",
  };

  const { container } = await renderElement(
    React.createElement(InterviewInteractiveHarness, {
      onSubmit: (payload) => submissions.push(payload),
      question,
    }),
  );

  assert.match(container.textContent ?? "", /Describe this system architecture/);

  const questionTurn = container.querySelector(
    "[data-slot='assessment-question-turn']",
  );
  assert.ok(questionTurn);
  assert.equal(questionTurn.querySelector("textarea"), null);
  assert.equal(questionTurn.querySelector("button[type='submit']"), null);

  const composer = container.querySelector("[data-slot='assessment-composer']");
  assert.ok(composer);
  const textarea = composer.querySelector("textarea") as HTMLTextAreaElement;
  assert.ok(textarea);

  await changeText(textarea, "Payment service with ML fraud scoring");

  // Shift+Enter does not submit
  await keyDown(textarea, { key: "Enter", shiftKey: true });
  assert.equal(submissions.length, 0);

  // IME composing Enter does not submit
  await keyDown(textarea, { isComposing: true, key: "Enter" });
  assert.equal(submissions.length, 0);

  // Enter submits
  await keyDown(textarea, { key: "Enter" });
  assert.equal(submissions.length, 1);
  assert.deepEqual(submissions[0], {
    freeText: "Payment service with ML fraud scoring",
    questionId: "q-free-1",
  });

  // Send button click submits
  const sendButton = composer.querySelector("button[type='submit']");
  assert.ok(sendButton);
  await click(sendButton as HTMLElement);
  assert.equal(submissions.length, 2);
  assert.deepEqual(submissions[1], {
    freeText: "Payment service with ML fraud scoring",
    questionId: "q-free-1",
  });
});

test("SINGLE_SELECT: click updates selection only (no mutation), Enter/Send submits selectedChoiceIds with empty text", async () => {
  const submissions: unknown[] = [];
  const question: AssessmentInterviewQuestion = {
    choices: [
      { id: "fraud_analyst", label: "Fraud analyst" },
      { id: "support_agent", label: "Support agent" },
    ],
    control: ASSESSMENT_INTERVIEW_CONTROLS.singleSelect,
    id: "q-single-1",
    intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
    prompt: "Who can override a decision?",
  };

  const { container } = await renderElement(
    React.createElement(InterviewInteractiveHarness, {
      onSubmit: (payload) => submissions.push(payload),
      question,
    }),
  );

  const radios = container.querySelectorAll<HTMLButtonElement>("[role='radio']");
  assert.equal(radios.length, 2);

  // Click option A -> selects A only, mutation NOT called
  await click(radios[0]);
  assert.equal(radios[0].getAttribute("aria-checked"), "true");
  assert.equal(submissions.length, 0);

  // Composer Send button is now enabled even though composer text is empty
  const sendButton = container.querySelector(
    "[data-slot='assessment-composer'] button[type='submit']",
  ) as HTMLButtonElement;
  assert.ok(sendButton);
  assert.equal(sendButton.disabled, false);

  // Press Send
  await click(sendButton);
  assert.equal(submissions.length, 1);
  assert.deepEqual(submissions[0], {
    questionId: "q-single-1",
    selectedChoiceIds: ["fraud_analyst"],
  });

  // Press Enter in composer -> submits without duplicate call
  const textarea = container.querySelector(
    "[data-slot='assessment-composer'] textarea",
  ) as HTMLTextAreaElement;
  assert.ok(textarea);
  await keyDown(textarea, { key: "Enter" });
  assert.equal(submissions.length, 2);
  assert.deepEqual(submissions[1], {
    questionId: "q-single-1",
    selectedChoiceIds: ["fraud_analyst"],
  });
});

test("OTHER / requiresFreeText: requires custom text in shared composer before submission and sends otherText", async () => {
  const submissions: unknown[] = [];
  const question: AssessmentInterviewQuestion = {
    choices: [
      { id: "fraud_analyst", label: "Fraud analyst" },
      { id: "custom_role", label: "Other / custom", requiresFreeText: true },
    ],
    control: ASSESSMENT_INTERVIEW_CONTROLS.singleSelect,
    id: "q-other-1",
    intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
    prompt: "Who can override a decision?",
  };

  const { container } = await renderElement(
    React.createElement(InterviewInteractiveHarness, {
      onSubmit: (payload) => submissions.push(payload),
      question,
    }),
  );

  const radios = container.querySelectorAll<HTMLButtonElement>("[role='radio']");
  assert.equal(radios.length, 2);

  // Select option with requiresFreeText
  await click(radios[1]);
  assert.equal(radios[1].getAttribute("aria-checked"), "true");

  // Assert NO inline textarea exists in question turn
  const questionTurn = container.querySelector(
    "[data-slot='assessment-question-turn']",
  );
  assert.equal(questionTurn?.querySelector("textarea"), null);

  // Send button should remain disabled while composer text is empty
  const sendButton = container.querySelector(
    "[data-slot='assessment-composer'] button[type='submit']",
  ) as HTMLButtonElement;
  assert.equal(sendButton.disabled, true);

  // Type custom role into shared composer
  const textarea = container.querySelector(
    "[data-slot='assessment-composer'] textarea",
  ) as HTMLTextAreaElement;
  await changeText(textarea, "Lead Compliance Officer with Tier-3 Signoff");

  // Now Send button is enabled
  assert.equal(sendButton.disabled, false);

  // Submit
  await click(sendButton);
  assert.equal(submissions.length, 1);
  assert.deepEqual(submissions[0], {
    otherText: "Lead Compliance Officer with Tier-3 Signoff",
    questionId: "q-other-1",
    selectedChoiceIds: ["custom_role"],
  });
});

test("OTHER IS NOT HARDCODED: custom choice where label is not 'Other' triggers free-text continuation", async () => {
  const submissions: unknown[] = [];
  const question: AssessmentInterviewQuestion = {
    choices: [
      { id: "standard", label: "Standard automated policy" },
      {
        id: "special_delegate",
        label: "Designated committee member",
        requiresFreeText: true,
      },
    ],
    control: ASSESSMENT_INTERVIEW_CONTROLS.singleSelect,
    id: "q-semantic-1",
    intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
    prompt: "Select approval routing",
  };

  const { container } = await renderElement(
    React.createElement(InterviewInteractiveHarness, {
      onSubmit: (payload) => submissions.push(payload),
      question,
    }),
  );

  const radios = container.querySelectorAll<HTMLButtonElement>("[role='radio']");
  await click(radios[1]);

  const sendButton = container.querySelector(
    "[data-slot='assessment-composer'] button[type='submit']",
  ) as HTMLButtonElement;
  assert.equal(sendButton.disabled, true);

  const textarea = container.querySelector(
    "[data-slot='assessment-composer'] textarea",
  ) as HTMLTextAreaElement;
  await changeText(textarea, "VP of Risk Operations");

  assert.equal(sendButton.disabled, false);
  await click(sendButton);
  assert.equal(submissions.length, 1);
  assert.deepEqual(submissions[0], {
    otherText: "VP of Risk Operations",
    questionId: "q-semantic-1",
    selectedChoiceIds: ["special_delegate"],
  });
});

test("BOOLEAN: uses ChatSingleSelect, selection on click, submits on Enter/Send", async () => {
  const submissions: unknown[] = [];
  const question: AssessmentInterviewQuestion = {
    control: ASSESSMENT_INTERVIEW_CONTROLS.boolean,
    id: "q-bool-1",
    intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
    prompt: "Does this workflow require secondary human review?",
  };

  const { container } = await renderElement(
    React.createElement(InterviewInteractiveHarness, {
      onSubmit: (payload) => submissions.push(payload),
      question,
    }),
  );

  const radios = container.querySelectorAll<HTMLButtonElement>("[role='radio']");
  assert.equal(radios.length, 2);

  // Click Yes
  await click(radios[0]);
  assert.equal(radios[0].getAttribute("aria-checked"), "true");
  assert.equal(submissions.length, 0);

  // Send submits
  const sendButton = container.querySelector(
    "[data-slot='assessment-composer'] button[type='submit']",
  ) as HTMLButtonElement;
  await click(sendButton);
  assert.equal(submissions.length, 1);
  assert.deepEqual(submissions[0], {
    questionId: "q-bool-1",
    selectedChoiceIds: ["yes"],
  });
});

test("MULTI_SELECT: supports toggle selection, deselect, and multi-value submission with requiresFreeText support", async () => {
  const submissions: unknown[] = [];
  const question: AssessmentInterviewQuestion = {
    choices: [
      { id: "opt_a", label: "Option A" },
      { id: "opt_b", label: "Option B" },
      { id: "opt_c", label: "Option C (custom)", requiresFreeText: true },
    ],
    control: ASSESSMENT_INTERVIEW_CONTROLS.multiSelect,
    id: "q-multi-1",
    intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
    prompt: "Select all relevant data sources",
  };

  const { container } = await renderElement(
    React.createElement(InterviewInteractiveHarness, {
      onSubmit: (payload) => submissions.push(payload),
      question,
    }),
  );

  const checkboxes = container.querySelectorAll<HTMLButtonElement>(
    "[role='checkbox']",
  );
  assert.equal(checkboxes.length, 3);

  // Select A and B
  await click(checkboxes[0]);
  await click(checkboxes[1]);
  assert.equal(checkboxes[0].getAttribute("aria-checked"), "true");
  assert.equal(checkboxes[1].getAttribute("aria-checked"), "true");

  // Deselect A
  await click(checkboxes[0]);
  assert.equal(checkboxes[0].getAttribute("aria-checked"), "false");
  assert.equal(checkboxes[1].getAttribute("aria-checked"), "true");

  // Submit B
  const sendButton = container.querySelector(
    "[data-slot='assessment-composer'] button[type='submit']",
  ) as HTMLButtonElement;
  await click(sendButton);
  assert.equal(submissions.length, 1);
  assert.deepEqual(submissions[0], {
    questionId: "q-multi-1",
    selectedChoiceIds: ["opt_b"],
  });

  // Now select option C (requiresFreeText)
  await click(checkboxes[2]);
  assert.equal(sendButton.disabled, true);

  const textarea = container.querySelector(
    "[data-slot='assessment-composer'] textarea",
  ) as HTMLTextAreaElement;
  await changeText(textarea, "Custom PostgreSQL DB");

  assert.equal(sendButton.disabled, false);
  await click(sendButton);
  assert.equal(submissions.length, 2);
  assert.deepEqual(submissions[1], {
    otherText: "Custom PostgreSQL DB",
    questionId: "q-multi-1",
    selectedChoiceIds: ["opt_b", "opt_c"],
  });
});

test("CONFIRM_ADJUST: Confirm submits directly, Adjust routes through composer and submits adjusted text", async () => {
  const submissions: unknown[] = [];
  const question: AssessmentInterviewQuestion = {
    control: ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust,
    id: "q-confirm-1",
    intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify,
    prompt: "Confirm that payment overrides require two-party authorization?",
  };

  const { container } = await renderElement(
    React.createElement(InterviewInteractiveHarness, {
      onSubmit: (payload) => submissions.push(payload),
      question,
    }),
  );

  const actionContainer = container.querySelector(
    "[data-slot='confirm-adjust-actions']",
  );
  assert.ok(actionContainer);
  const buttons = actionContainer.querySelectorAll("button");
  assert.equal(buttons.length, 2);

  const composer = container.querySelector("[data-slot='assessment-composer']");
  assert.ok(composer);
  const textarea = composer.querySelector("textarea") as HTMLTextAreaElement;
  assert.ok(textarea);

  // Initially before clicking Adjust, composer is disabled
  assert.equal(textarea.disabled, true);

  // Click Confirm -> submits immediately with { confirmed: true, questionId }
  await click(buttons[0]);
  assert.equal(submissions.length, 1);
  assert.deepEqual(submissions[0], {
    confirmed: true,
    questionId: "q-confirm-1",
  });

  // Click Adjust -> activates composer, displays continue in composer hint
  await click(buttons[1]);
  assert.equal(textarea.disabled, false);
  assert.match(
    actionContainer.textContent ?? "",
    /Continue in composer|Tiếp tục trong ô nhập/i,
  );

  // Empty adjustment cannot be submitted
  await keyDown(textarea, { key: "Enter" });
  assert.equal(submissions.length, 1);

  // Enter adjustment text -> submit ready -> Enter submits adjusted: true + freeText
  await changeText(
    textarea,
    "Payment overrides require three-party authorization in production.",
  );
  await keyDown(textarea, { key: "Enter" });

  assert.equal(submissions.length, 2);
  assert.deepEqual(submissions[1], {
    adjusted: true,
    freeText:
      "Payment overrides require three-party authorization in production.",
    questionId: "q-confirm-1",
  });
});

test("ASK vs CLARIFY: preserves semantic data-intent attribute without rewrite", async () => {
  const askQuestion: AssessmentInterviewQuestion = {
    control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
    id: "q-ask",
    intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
    prompt: "Ask prompt",
  };
  const clarifyQuestion: AssessmentInterviewQuestion = {
    control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
    id: "q-clarify",
    intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.clarify,
    prompt: "Clarify prompt",
  };

  const { container: askContainer } = await renderElement(
    React.createElement(AssessmentQuestionTurn, { question: askQuestion }),
  );
  const { container: clarifyContainer } = await renderElement(
    React.createElement(AssessmentQuestionTurn, { question: clarifyQuestion }),
  );

  assert.equal(
    askContainer
      .querySelector("[data-slot='assessment-question-turn']")
      ?.getAttribute("data-intent"),
    "ASK",
  );
  assert.equal(
    clarifyContainer
      .querySelector("[data-slot='assessment-question-turn']")
      ?.getAttribute("data-intent"),
    "CLARIFY",
  );
});

test("CUSTOMER-SAFE EVIDENCE: raw evidence refs are absent from visible text, DOM attributes, and markup", async () => {
  const question: AssessmentInterviewQuestion = {
    control: ASSESSMENT_INTERVIEW_CONTROLS.singleSelect,
    id: "q-safe-1",
    intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
    prompt: "Select model provider",
    whyEvidenceRefs: [
      "raw_internal_ast_node_9941a",
      "pge_edge_secret_calc_3301",
    ],
  };

  const { container } = await renderElement(
    React.createElement(AssessmentQuestionTurn, { question }),
  );

  // Raw evidence strings must NOT appear in visible text or ANY rendered DOM attributes / innerHTML
  assert.equal(
    container.textContent?.includes("raw_internal_ast_node_9941a"),
    false,
  );
  assert.equal(
    container.textContent?.includes("pge_edge_secret_calc_3301"),
    false,
  );
  assert.equal(
    container.innerHTML.includes("raw_internal_ast_node_9941a"),
    false,
  );
  assert.equal(
    container.innerHTML.includes("pge_edge_secret_calc_3301"),
    false,
  );

  // Click why disclosure
  const whyButton = container.querySelector(
    "[data-slot='why-asking-disclosure'] button",
  ) as HTMLButtonElement;
  assert.ok(whyButton);
  await click(whyButton);

  // Safe note is shown, raw internal IDs are NOT printed in text or markup
  assert.equal(
    container.textContent?.includes("raw_internal_ast_node_9941a"),
    false,
  );
  assert.equal(
    container.innerHTML.includes("raw_internal_ast_node_9941a"),
    false,
  );
  assert.equal(
    container
      .querySelector("[data-slot='why-asking-disclosure']")
      ?.hasAttribute("data-evidence-refs"),
    false,
  );
});

test("BLOCKED_OR_UNRESOLVED: renders exactly the 3 approved MVP actions", async () => {
  const actions: string[] = [];
  const question: AssessmentInterviewQuestion = {
    control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
    id: "q-blocked-1",
    intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
    prompt: "Describe system boundaries",
  };

  const { container } = await renderElement(
    React.createElement(AssessmentQuestionTurn, {
      blockedActions: [
        ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.provideMoreContext,
        ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.checkInternally,
        ASSESSMENT_INTERVIEW_BLOCKED_ACTIONS.saveAndExit,
      ],
      onBlockedAction: (action) => actions.push(action),
      question,
    }),
  );

  const blockedContainer = container.querySelector(
    "[data-slot='blocked-or-unresolved-actions']",
  );
  assert.ok(blockedContainer);
  const buttons = blockedContainer.querySelectorAll("button");
  assert.equal(buttons.length, 3);

  // No Support button
  assert.equal(/Support/i.test(blockedContainer.textContent ?? ""), false);

  await click(buttons[0]);
  assert.equal(actions[0], "PROVIDE_MORE_CONTEXT");

  await click(buttons[1]);
  assert.equal(actions[1], "CHECK_INTERNALLY");

  await click(buttons[2]);
  assert.equal(actions[2], "SAVE_AND_EXIT");
});

test("STALE / DISABLED: response action and composer cannot submit when disabled", async () => {
  const submissions: unknown[] = [];
  const question: AssessmentInterviewQuestion = {
    control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
    id: "q-stale-1",
    intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
    prompt: "Stale prompt",
  };

  const { container } = await renderElement(
    React.createElement(InterviewInteractiveHarness, {
      disabled: true,
      onSubmit: (payload) => submissions.push(payload),
      question,
    }),
  );

  const sendButton = container.querySelector(
    "[data-slot='assessment-composer'] button[type='submit']",
  ) as HTMLButtonElement;
  assert.equal(sendButton.disabled, true);

  const textarea = container.querySelector(
    "[data-slot='assessment-composer'] textarea",
  ) as HTMLTextAreaElement;
  assert.equal(textarea.disabled, true);
});

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

async function changeText(textarea: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      testWindow.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    nativeSetter?.call(textarea, value);
    textarea.dispatchEvent(new testWindow.Event("input", { bubbles: true }));
    textarea.dispatchEvent(new testWindow.Event("change", { bubbles: true }));
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
