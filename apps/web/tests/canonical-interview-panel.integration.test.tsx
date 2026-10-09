import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement, type ReactNode } from "react";

import {
  ASSESSMENT_INTERVIEW_CONTROLS,
  ASSESSMENT_CONTEXT_AUTHORITY_STATUSES,
  ASSESSMENT_INTERVIEW_OUTCOMES,
  ASSESSMENT_INTERVIEW_QUESTION_INTENTS,
  type AssessmentInterviewQuestion,
  type AssessmentInterviewRuntimeState,
} from "@lcsp/contracts/evidence";
import {
  ASSESSMENT_LIFECYCLE_STATES,
  HUMAN_RESOLUTION_REQUEST_STATUSES,
} from "@lcsp/contracts/assessment";
import {
  HUMAN_RESOLUTION_CONTROL_TYPES,
} from "@lcsp/contracts/assessment-domain";
import { apiQueryKeys } from "../src/lib/api/query-keys";

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "http://localhost/assessments/integration-1",
});
const testWindow = dom.window;
for (const [name, value] of [
  ["window", testWindow],
  ["document", testWindow.document],
  ["navigator", testWindow.navigator],
  ["Element", testWindow.Element],
  ["HTMLElement", testWindow.HTMLElement],
  ["HTMLButtonElement", testWindow.HTMLButtonElement],
  ["HTMLTextAreaElement", testWindow.HTMLTextAreaElement],
  ["HTMLFormElement", testWindow.HTMLFormElement],
  ["KeyboardEvent", testWindow.KeyboardEvent],
  ["MouseEvent", testWindow.MouseEvent],
  ["Event", testWindow.Event],
  ["Node", testWindow.Node],
] as const) {
  Object.defineProperty(globalThis, name, { configurable: true, value });
}
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
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

let lastEventSource: TestEventSource | null = null;
class TestEventSource {
  private listeners = new Map<string, (event: MessageEvent<string>) => void>();
  constructor() {
    // The test source is intentionally exposed so the mounted runtime provider
    // can receive a canonical snapshot after its effect subscribes.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastEventSource = this;
  }
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, listener);
  }
  emit(type: string, data: string) {
    this.listeners.get(type)?.(new testWindow.MessageEvent(type, { data }));
  }
  close() {}
}
Object.defineProperty(globalThis, "EventSource", {
  configurable: true,
  value: TestEventSource,
});

const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import(
  "@tanstack/react-query"
);
const { WorkspaceRuntimeProvider } = await import(
  "../src/features/workspace/components/organisms/workspace-runtime-provider"
);
const { CanonicalInterviewPanel } = await import(
  "../src/features/workspace/components/organisms/canonical-interview-panel"
);
const { AssessmentOverview } = await import(
  "../src/features/workspace/components/organisms/assessment-overview"
);
const { assessmentDomainKeys } = await import(
  "../src/lib/api/assessment-domain-queries"
);

const assessmentId = "00000000-0000-4000-8000-000000000001";
const roots: ReturnType<typeof createRoot>[] = [];
let fetchImpl: typeof globalThis.fetch;

afterEach(() => {
  globalThis.fetch = fetchImpl;
  for (const root of roots.splice(0)) act(() => root.unmount());
  testWindow.document.getElementById("root")?.replaceChildren();
});

function question(
  id: string,
  control: AssessmentInterviewQuestion["control"] =
    ASSESSMENT_INTERVIEW_CONTROLS.singleSelect,
): AssessmentInterviewQuestion {
  return {
    id,
    intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
    control,
    prompt: `Prompt ${id}`,
    choices:
      control === ASSESSMENT_INTERVIEW_CONTROLS.freeText
        ? undefined
        : [
            { id: "normal", label: "Normal" },
            { id: "other", label: "Other", requiresFreeText: true },
          ],
  };
}

function interviewState(activeQuestion: AssessmentInterviewQuestion | null): AssessmentInterviewRuntimeState {
  return {
    outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
    threadId: "00000000-0000-4000-8000-000000000002",
    contextRevision: 1,
    activeQuestion,
    answerHistory: [],
  } as AssessmentInterviewRuntimeState;
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function envelope(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function mount(
  state: AssessmentInterviewRuntimeState,
  options: {
    lifecycleState?: (typeof ASSESSMENT_LIFECYCLE_STATES)[keyof typeof ASSESSMENT_LIFECYCLE_STATES];
    mutation?: (input: unknown) => Promise<Response>;
    humanMutation?: (input: unknown) => Promise<Response>;
    interviewFetch?: () => Promise<Response>;
    detailFetch?: () => Promise<Response>;
    humanRequestsFetch?: () => Promise<Response>;
    child?: ReactNode;
    seed?: (queryClient: InstanceType<typeof QueryClient>) => void;
  } = {},
) {
  const current = state;
  const mutation = options.mutation ?? (() => Promise.resolve(envelope(current)));
  fetchImpl = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path.includes("/human-requests/") && init?.method === "POST") {
      return options.humanMutation
        ? options.humanMutation(JSON.parse(String(init.body)))
        : envelope(null);
    }
    if (path.endsWith(`/assessments/${assessmentId}`) && init?.method !== "POST") {
      return options.detailFetch ? options.detailFetch() : envelope(null);
    }
    if (path.endsWith(`/assessments/${assessmentId}/human-requests`)) {
      return options.humanRequestsFetch ? options.humanRequestsFetch() : envelope(null);
    }
    if (path.includes("/interview") && init?.method === "POST") {
      return mutation(JSON.parse(String(init.body)));
    }
    if (path.includes("/interview")) {
      return options.interviewFetch ? options.interviewFetch() : envelope(current);
    }
    if (path.includes("/artifacts")) return envelope(null);
    return envelope(null);
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  options.seed?.(queryClient);
  const root = createRoot(testWindow.document.getElementById("root")!);
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          WorkspaceRuntimeProvider,
          null,
          options.child ??
            createElement(CanonicalInterviewPanel, {
              assessmentId,
              lifecycleState:
                options.lifecycleState ??
                ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_REQUIRED_INPUT,
              canonicalAvailable: true,
            }),
        ),
      ),
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    emitCanonicalRuntime(options.lifecycleState);
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  return { container: testWindow.document.getElementById("root")!, queryClient, root };
}

function emitCanonicalRuntime(
  lifecycleState: (typeof ASSESSMENT_LIFECYCLE_STATES)[keyof typeof ASSESSMENT_LIFECYCLE_STATES] | undefined,
) {
  lastEventSource?.emit(
    "workspace.runtime",
    JSON.stringify({
        emitted_at: "2026-10-08T00:00:00.000Z",
        canonical_assessments: [
          {
            assessmentId,
            lifecycle: {
              state:
                lifecycleState ??
                ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_REQUIRED_INPUT,
              assessmentRevision: 1,
            },
            runtime: {
              threadId: "00000000-0000-4000-8000-000000000002",
              rootAgentVersion: "test",
              checkpointNamespace: "00000000-0000-4000-8000-000000000003",
              checkpointId: null,
              currentExecutionId: "00000000-0000-4000-8000-000000000004",
              executionState: "RUNNING",
              eventSequence: 1,
              startedAt: "2026-10-08T00:00:00.000Z",
              lastResumedAt: null,
              updatedAt: "2026-10-08T00:00:00.000Z",
            },
          },
        ],
        canonical_events: [],
      }),
  );
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new testWindow.MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function changeText(element: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(element),
      "value",
    )?.set;
    setter?.call(element, value);
    element.dispatchEvent(new testWindow.Event("input", { bubbles: true }));
    element.dispatchEvent(new testWindow.Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

test("canonical panel locks immediately and sends one structured command", async () => {
  let resolveMutation!: (response: Response) => void;
  const mutation = () => new Promise<Response>((resolve) => (resolveMutation = resolve));
  const { container } = await mount(interviewState(question("q1")), { mutation });
  const choice = container.querySelectorAll<HTMLElement>("[role='radio']")[0];
  await click(choice);
  const action = container.querySelector<HTMLButtonElement>(
    "[data-slot='selection-submit-action'] button",
  )!;
  assert.equal(action.disabled, false);
  await click(action);
  await click(action);
  assert.equal(action.disabled, true);
  assert.equal(
    container.querySelectorAll("[data-slot='selection-submit-action'] button").length,
    1,
  );
  resolveMutation(envelope(interviewState(question("q1"))));
});

test("canonical panel preserves required-text input while making composer submission unavailable", async () => {
  const { container } = await mount(interviewState(question("q-required")));
  const radios = container.querySelectorAll<HTMLElement>("[role='radio']");
  await click(radios[1]);
  const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
  const composerSend = container.querySelector<HTMLButtonElement>(
    "[data-slot='assessment-composer'] button[type='submit']",
  )!;
  const action = container.querySelector<HTMLButtonElement>(
    "[data-slot='selection-submit-action'] button",
  )!;
  await changeText(textarea, "required explanation");
  assert.equal(textarea.disabled, false);
  assert.equal(composerSend.disabled, true);
  assert.equal(action.disabled, false);
});

test("canonical panel is read-only when lifecycle interaction is not eligible", async () => {
  const { container } = await mount(interviewState(question("q-readonly")), {
    lifecycleState: ASSESSMENT_LIFECYCLE_STATES.PAUSED,
  });
  assert.equal(container.querySelector("textarea"), null);
  const action = container.querySelector<HTMLButtonElement>(
    "[data-slot='selection-submit-action'] button",
  );
  assert.ok(action);
  assert.equal(action.disabled, true);
});

test("canonical panel keeps the same question locked after success and refetch", async () => {
  let calls = 0;
  let resolveMutation!: (response: Response) => void;
  const q1 = question("q-refetch");
  const mounted = await mount(interviewState(q1), {
    mutation: () => {
      calls += 1;
      return new Promise<Response>((resolve) => (resolveMutation = resolve));
    },
  });
  const { container, queryClient } = mounted;
  await click(container.querySelectorAll<HTMLElement>("[role='radio']")[0]);
  const action = container.querySelector<HTMLButtonElement>(
    "[data-slot='selection-submit-action'] button",
  )!;
  await click(action);
  assert.equal(calls, 1);
  assert.equal(action.disabled, true);
  resolveMutation(envelope(interviewState(q1)));
  await settle();
  queryClient.setQueryData(apiQueryKeys.assessment.interview(assessmentId), interviewState(q1));
  await settle();
  const refetchedAction = container.querySelector<HTMLButtonElement>(
    "[data-slot='selection-submit-action'] button",
  )!;
  assert.equal(refetchedAction.disabled, true);
  await click(refetchedAction);
  assert.equal(calls, 1);
});

test("canonical panel releases a failed structured answer for retry without losing the draft", async () => {
  let calls = 0;
  let rejectMutation!: (error: Error) => void;
  let resolveRetry!: (response: Response) => void;
  const mounted = await mount(interviewState(question("q-retry")), {
    mutation: () => {
      calls += 1;
      if (calls === 1) return new Promise<Response>((_, reject) => (rejectMutation = reject));
      return new Promise<Response>((resolve) => (resolveRetry = resolve));
    },
  });
  const { container } = mounted;
  await click(container.querySelectorAll<HTMLElement>("[role='radio']")[0]);
  const action = container.querySelector<HTMLButtonElement>(
    "[data-slot='selection-submit-action'] button",
  )!;
  await click(action);
  assert.equal(action.disabled, true);
  rejectMutation(new Error("temporary network failure"));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  const retryAction = container.querySelector<HTMLButtonElement>(
    "[data-slot='selection-submit-action'] button",
  )!;
  assert.equal(retryAction.disabled, false);
  await click(retryAction);
  assert.equal(calls, 2);
  resolveRetry(envelope(interviewState(question("q-retry"))));
  await settle();
  assert.equal(
    container.querySelector<HTMLButtonElement>(
      "[data-slot='selection-submit-action'] button",
    )!.disabled,
    true,
  );
});

test("canonical panel resets draft, lock and mode when the authoritative question changes", async () => {
  let calls = 0;
  let resolveMutation!: (response: Response) => void;
  const q1 = question("q-one");
  const q2 = question("q-two", ASSESSMENT_INTERVIEW_CONTROLS.freeText);
  const mounted = await mount(interviewState(q1), {
    mutation: () => {
      calls += 1;
      return new Promise<Response>((resolve) => (resolveMutation = resolve));
    },
  });
  const { container, queryClient } = mounted;
  await click(container.querySelectorAll<HTMLElement>("[role='radio']")[1]);
  const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
  await changeText(textarea, "draft for q1");
  const action = container.querySelector<HTMLButtonElement>(
    "[data-slot='selection-submit-action'] button",
  )!;
  await click(action);
  assert.equal(calls, 1);
  resolveMutation(envelope(interviewState(q1)));
  await settle();
  queryClient.setQueryData(
    apiQueryKeys.assessment.interview(assessmentId),
    interviewState(q2),
  );
  await settle();
  const q2Textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
  assert.equal(q2Textarea.value, "");
  assert.equal(q2Textarea.disabled, false);
  assert.equal(
    container.querySelector("[data-slot='selection-submit-action']"),
    null,
  );
  await changeText(q2Textarea, "answer for q2");
  await click(container.querySelector<HTMLButtonElement>("button[type='submit']")!);
  assert.equal(calls, 2);
});

test("canonical panel blocks stale Interview answers even with a valid draft", async () => {
  const stale = {
    ...interviewState(question("q-stale")),
    contextAuthority: ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.superseded,
  } as AssessmentInterviewRuntimeState;
  let calls = 0;
  const mounted = await mount(stale, { mutation: async () => {
    calls += 1;
    return envelope(stale);
  }});
  const { container } = mounted;
  assert.equal(container.querySelector("textarea"), null);
  const action = container.querySelector<HTMLButtonElement>(
    "[data-slot='selection-submit-action'] button",
  );
  assert.ok(action);
  assert.equal(action.disabled, true);
  await click(action);
  assert.equal(calls, 0);
});

test("canonical panel keeps an active structured action visible beside read-only answer history", async () => {
  const mounted = await mount(interviewState(question("q-history")));
  const { container, queryClient } = mounted;
  queryClient.setQueryData(
    apiQueryKeys.assessment.interview(assessmentId),
    {
      ...interviewState(question("q-history")),
      answerHistory: [
        {
          questionId: "q-old",
          question: question("q-old"),
          summary: "Previously recorded answer",
          answeredAt: "2026-10-08T00:00:00.000Z",
        },
      ],
    },
  );
  await settle();
  assert.match(container.textContent ?? "", /Previously recorded answer/);
  assert.ok(container.querySelector("[data-history-question-id='q-old']"));
  const action = container.querySelector<HTMLButtonElement>(
    "[data-slot='selection-submit-action'] button",
  );
  assert.ok(action);
  await click(container.querySelectorAll<HTMLElement>("[role='radio']")[0]);
  assert.equal(action.disabled, false);
});

test("canonical panel preserves confirmed and adjusted historical interpretations as read-only", async () => {
  const mounted = await mount(interviewState(question("q-history-active")));
  const { container, queryClient } = mounted;
  const confirmedInterpretation = "Original statement A";
  const adjustedInterpretation = "Original statement for adjustment";
  queryClient.setQueryData(
    apiQueryKeys.assessment.interview(assessmentId),
    {
      ...interviewState(question("q-history-active")),
      answerHistory: [
        {
          questionId: "q-confirmed-history",
          question: {
            ...question(
              "q-confirmed-history",
              ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust,
            ),
            proposedInterpretation: confirmedInterpretation,
          },
          summary: "Confirmed answer",
          answeredAt: "2026-10-08T00:00:00.000Z",
        },
        {
          questionId: "q-adjusted-history",
          question: {
            ...question(
              "q-adjusted-history",
              ASSESSMENT_INTERVIEW_CONTROLS.confirmAdjust,
            ),
            proposedInterpretation: adjustedInterpretation,
          },
          summary: "Adjusted answer",
          comment: "Customer correction B",
          answeredAt: "2026-10-08T00:01:00.000Z",
        },
      ],
    },
  );
  await settle();

  const history = container.querySelector(
    "[data-slot='canonical-interview-history']",
  );
  assert.ok(history);
  const interpretations = history.querySelectorAll(
    "[data-slot='proposed-interpretation']",
  );
  assert.equal(interpretations.length, 2);
  assert.equal(interpretations[0]?.textContent, confirmedInterpretation);
  assert.equal(interpretations[1]?.textContent, adjustedInterpretation);
  assert.match(history.textContent ?? "", /Confirmed answer/);
  assert.match(history.textContent ?? "", /Adjusted answer/);
  assert.match(history.textContent ?? "", /Customer correction B/);
  assert.equal(history.querySelectorAll("button").length, 0);
});

test("canonical panel keeps historical entries without question metadata readable", async () => {
  const mounted = await mount(interviewState(question("q-history-fallback")));
  const { container, queryClient } = mounted;
  queryClient.setQueryData(
    apiQueryKeys.assessment.interview(assessmentId),
    {
      ...interviewState(question("q-history-fallback")),
      answerHistory: [
        {
          questionId: "q-no-question",
          summary: "Historical summary without question metadata",
          answeredAt: "2026-10-08T00:02:00.000Z",
        },
        {
          questionId: "q-no-interpretation",
          question: question(
            "q-no-interpretation",
            ASSESSMENT_INTERVIEW_CONTROLS.singleSelect,
          ),
          summary: "Historical ordinary selection",
          answeredAt: "2026-10-08T00:03:00.000Z",
        },
      ],
    },
  );
  await settle();
  const history = container.querySelector(
    "[data-slot='canonical-interview-history']",
  );
  assert.ok(history);
  assert.match(history.textContent ?? "", /Historical summary without question metadata/);
  assert.match(history.textContent ?? "", /Historical ordinary selection/);
  assert.equal(
    history.querySelectorAll("[data-slot='proposed-interpretation']").length,
    0,
  );
});

test("canonical panel keeps loading and error states local to Interview", async () => {
  let resolveInterview!: (response: Response) => void;
  const loading = await mount(interviewState(question("q-loading")), {
    interviewFetch: () =>
      new Promise<Response>((resolve) => (resolveInterview = resolve)),
  });
  assert.equal(loading.container.querySelector("[aria-busy='true']") !== null, true);
  assert.equal(loading.container.querySelector("[data-slot='selection-submit-action']"), null);
  resolveInterview(envelope(interviewState(question("q-loading"))));
  loading.queryClient.setQueryData(
    apiQueryKeys.assessment.interview(assessmentId),
    interviewState(question("q-loading")),
  );
  await settle();
  assert.ok(loading.container.querySelector("[data-slot='selection-submit-action']"));

  await act(async () => loading.root.unmount());
  const failed = await mount(interviewState(question("q-error")), {
    interviewFetch: async () => {
      throw new Error("Interview unavailable");
    },
  });
  assert.ok(failed.container.querySelector("[data-slot='canonical-interview-panel']"));
  assert.ok(failed.container.querySelector("button"));
  assert.equal(failed.container.querySelector("[data-slot='selection-submit-action']"), null);
});

test("canonical assessment keeps Interview and Human Resolution workflows independent", async () => {
  const requestId = "00000000-0000-4000-8000-000000000010";
  const assessmentDetail = {
    assessment_id: assessmentId,
    name: "Integration assessment",
    owner_id: "owner-1",
    lifecycle: {
      state: ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_REQUIRED_INPUT,
      assessmentRevision: 1,
    },
    runtime: {
      threadId: "00000000-0000-4000-8000-000000000002",
      rootAgentVersion: "test",
      checkpointNamespace: "00000000-0000-4000-8000-000000000003",
      checkpointId: null,
      currentExecutionId: "00000000-0000-4000-8000-000000000004",
      executionState: "RUNNING",
      eventSequence: 1,
      startedAt: "2026-10-08T00:00:00.000Z",
      lastResumedAt: null,
      updatedAt: "2026-10-08T00:00:00.000Z",
    },
    case: null,
    created_at: "2026-10-08T00:00:00.000Z",
    updated_at: "2026-10-08T00:00:00.000Z",
    correlationId: "correlation-1",
  };
  const humanRequest = {
    requestId,
    requestRevision: 1,
    openedCaseRevision: 1,
    status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
    checkpointId: null,
    resolvedFactId: null,
    answers: [],
    engineeringRuleId: "rule-1",
    criterionIds: ["criterion-1"],
    question: "Which fact should be recorded?",
    unresolvedFact: "A required fact is unresolved.",
    decisionImpact: ["Decision impact"],
    resolutionAttempts: ["Interview evidence was insufficient."],
    controlType: HUMAN_RESOLUTION_CONTROL_TYPES.FREE_TEXT,
    choices: [],
  };
  let interviewCalls = 0;
  let humanCalls = 0;
  const mounted = await mount(interviewState(question("q-overview")), {
    child: createElement(AssessmentOverview, { assessmentId }),
    mutation: async () => {
      interviewCalls += 1;
      return envelope(interviewState(question("q-overview")));
    },
    humanMutation: async () => {
      humanCalls += 1;
      return envelope({
        requestId,
        requestRevision: 1,
        caseRevision: 1,
        status: HUMAN_RESOLUTION_REQUEST_STATUSES.RESOLVED,
        factId: null,
        resumed: false,
        replayed: false,
      });
    },
    detailFetch: async () => envelope(assessmentDetail),
    humanRequestsFetch: async () =>
      envelope({ caseRevision: 1, requests: [humanRequest] }),
    seed: (queryClient) => {
      queryClient.setQueryData(assessmentDomainKeys.detail(assessmentId), assessmentDetail);
      queryClient.setQueryData(assessmentDomainKeys.requests(assessmentId), {
        caseRevision: 1,
        requests: [humanRequest],
      });
      queryClient.setQueryData(apiQueryKeys.assessment.artifacts(assessmentId), null);
    },
  });
  const { container } = mounted;
  assert.ok(container.querySelector("main[data-assessment-id]"));
  assert.ok(container.querySelector("[data-slot='canonical-interview-panel']"));
  assert.ok(container.querySelector(`[data-human-request='${requestId}']`));
  assert.ok(container.querySelector("[data-canonical-status='PRESENT']"));

  const interviewChoice = container.querySelector<HTMLElement>("[role='radio']");
  assert.ok(interviewChoice);
  await click(interviewChoice);
  await click(
    container.querySelector<HTMLButtonElement>(
      "[data-slot='selection-submit-action'] button",
    )!,
  );
  assert.equal(interviewCalls, 1);
  assert.equal(humanCalls, 0);

  const humanTextarea = container.querySelector<HTMLTextAreaElement>(
    `[data-human-request='${requestId}'] textarea`,
  );
  assert.ok(humanTextarea);
  await changeText(humanTextarea, "Recorded fact");
  await click(
    container.querySelector<HTMLButtonElement>(
      `[data-human-request='${requestId}'] button[type='submit']`,
    )!,
  );
  assert.equal(interviewCalls, 1);
  assert.equal(humanCalls, 1);
});
