import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buttons,
  byText,
  click,
  installFetch,
  render,
  settle,
} from "./support/dom.ts";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AGENT_EXECUTION_STATES as EXEC,
  ASSESSMENT_LIFECYCLE_STATES as LIFE,
} from "@lcsp/contracts/assessment";
import { HUMAN_RESOLUTION_CONTROL_TYPES } from "@lcsp/contracts/assessment-domain";
import { setAppLocale } from "../src/lib/locale.ts";
import { AssessmentConversation } from "../src/features/assessment-runtime/components/organisms/assessment-conversation.tsx";
import { AssessmentContextPanel } from "../src/features/assessment-runtime/components/organisms/assessment-context-panel.tsx";
import { AssessmentInteractionBar } from "../src/features/assessment-runtime/components/molecules/assessment-interaction-bar.tsx";
import { customerAssessmentState } from "../src/features/assessment-runtime/utils/customer-assessment-state.ts";
import { projectConversation } from "../src/features/assessment-runtime/utils/conversation-projection.ts";
import type { StructuredAnswer } from "../src/features/assessment-runtime/types/structured-answer.types.ts";
import {
  ARTIFACT_ID,
  ASSESSMENT_ID,
  EXECUTION_ID,
  LABEL,
  REQUEST_ID,
  detail,
  events,
  request,
} from "./support/assessment-conversation-fixtures.ts";

setAppLocale("en");

const REPOSITORY = { fullName: "acme/notice-service", commit: "c14f518" };
const ACTIVITY = [
  events.lifecycle(1, 0, LIFE.PREPARING, LIFE.ACTIVE),
  events.execution(2, 0, EXEC.QUEUED, EXEC.RUNNING),
  events.activity(3, 4, LABEL.RULE_INVESTIGATION_STARTED),
  events.activity(4, 8, LABEL.REPOSITORY_INSPECTED, { id: "inv-a", input: 100, output: 20 }),
  events.activity(5, 12, LABEL.REPOSITORY_INSPECTED, { id: "inv-b", input: 200, output: 30 }),
];

function projection(
  input: Partial<Parameters<typeof projectConversation>[0]> & {
    lifecycle?: (typeof LIFE)[keyof typeof LIFE];
    execution?: (typeof EXEC)[keyof typeof EXEC];
    decisions?: boolean;
    artifact?: boolean;
  } = {},
) {
  return projectConversation({
    assessmentId: ASSESSMENT_ID,
    events: ACTIVITY,
    detail: detail({
      lifecycle: input.lifecycle,
      execution: input.execution,
      decisions: input.decisions,
      artifact: input.artifact,
    }),
    requests: [],
    repository: REPOSITORY,
    ...input,
  });
}

const noop = () => undefined;

function conversation(
  value: ReturnType<typeof projection>,
  onAnswer: (answer: StructuredAnswer) => void = noop,
) {
  return render(
    <AssessmentConversation
      projection={value}
      answerPending={false}
      answerFailed={false}
      onAnswer={onAnswer}
    />,
  );
}

function withClient(node: React.ReactElement) {
  // Infinite gc: a finished query or mutation schedules no timer that could outlive the test.
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

const ENGLISH_ACTIVITY = ["Inspecting repository evidence", "Investigated assessment rules"];

test("the conversation owns the chronological activity: compact work disclosure, technical details collapsed", () => {
  const view = conversation(projection());
  const disclosure = view.querySelector<HTMLDetailsElement>('[data-slot="work-disclosure"]');
  assert.ok(disclosure);
  assert.equal(disclosure.open, true, "an in-flight turn is expanded");
  assert.match(disclosure.textContent ?? "", /Working…/);
  assert.match(disclosure.textContent ?? "", /Inspecting repository evidence… ×2/);
  assert.match(disclosure.textContent ?? "", /Investigated assessment rules/);
  const technical = view.querySelector<HTMLDetailsElement>('[data-slot="technical-details"]');
  assert.ok(technical);
  assert.equal(technical.open, false, "technical details stay collapsed");
  // Raw event codes exist only inside the collapsed technical details.
  const outside = view.cloneNode(true) as HTMLElement;
  outside.querySelectorAll('[data-slot="technical-details"]').forEach((node) => node.remove());
  assert.doesNotMatch(outside.textContent ?? "", /ACTIVITY_RECORDED|assessment\.activity\./);
});

test("a settled turn collapses to 'Worked for …' with no spinner anywhere", () => {
  const view = conversation(projection({ lifecycle: LIFE.PAUSED, execution: EXEC.PAUSED, events: [...ACTIVITY, events.execution(6, 14, EXEC.RUNNING, EXEC.PAUSED)] }));
  const disclosure = view.querySelector<HTMLDetailsElement>('[data-slot="work-disclosure"]');
  assert.ok(disclosure);
  assert.equal(disclosure.open, false, "a finished turn is collapsed by default");
  assert.match(disclosure.textContent ?? "", /Worked for 10s/);
  assert.equal(view.querySelectorAll(".animate-spin").length, 0);
  assert.equal(view.querySelectorAll('[data-slot="work-spinner"]').length, 0);
  assert.match(view.textContent ?? "", /Paused\. Continue when you're ready\./);
});

test("the right sidebar is context only: state, rule set, progress, usage and report, never the activity", async () => {
  const stub = installFetch({
    [`GET /api/assessments/${ASSESSMENT_ID}`]: detail({ usage: { invocationCount: 73, totalTokens: 1_650_000 } }),
    [`GET /api/assessments/${ASSESSMENT_ID}/repository-setup`]: {
      assessmentId: ASSESSMENT_ID,
      lifecycle: null,
      connection: { connectionId: "c1", provider: "GITHUB", repositoryId: "r1", repositoryFullName: "acme/notice-service", defaultBranch: "main", status: "ACTIVE" },
      snapshot: null,
      scanJob: null,
    },
  });
  try {
    const page = render(
      withClient(
        <div>
          <main data-slot="center">
            <AssessmentConversation projection={projection()} answerPending={false} answerFailed={false} onAnswer={noop} />
          </main>
          <AssessmentContextPanel assessmentId={ASSESSMENT_ID} />
        </div>,
      ),
    );
    await settle();
    const panel = page.querySelector('[data-slot="assessment-context"]');
    const center = page.querySelector('[data-slot="center"]');
    assert.ok(panel && center);
    const text = panel.textContent ?? "";
    assert.match(text, /Working/);
    assert.match(text, /2026\.10\.p1/);
    assert.match(text, /37 requirements · 62 assessment rules/);
    assert.match(text, /0 \/ 2 evaluated/);
    assert.match(text, /1\.65M tokens/);
    assert.match(text, /73 invocations/);
    assert.match(text, /Not ready/);
    assert.match(text, /acme\/notice-service/);
    // Regression: chronological activity is rendered in exactly one place.
    for (const label of ENGLISH_ACTIVITY) {
      assert.doesNotMatch(text, new RegExp(label), `sidebar repeats "${label}"`);
      assert.equal((center.textContent ?? "").split(label).length - 1, 1, `conversation shows "${label}" once`);
    }
    assert.equal(panel.querySelectorAll('[data-slot="work-disclosure"], ol, [data-turn-kind]').length, 0);
    // Raw lifecycle/execution live under Run details only.
    const runDetails = panel.querySelector<HTMLDetailsElement>('[data-slot="run-details"]');
    assert.ok(runDetails);
    assert.equal(runDetails.open, false);
  } finally {
    stub.restore();
  }
});

test("the context panel never imports or renders the conversation or an event feed", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../src/features/assessment-runtime/components/organisms/assessment-context-panel.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /CanonicalAssessmentActivity|AssessmentConversation|Conversation[A-Z]\w*Turn|canonicalEvents|useAssessmentEventsQuery|projectConversation/);
});

test("Human Resolution is an inline assistant question with a structured control, never a free-text box for a choice", () => {
  const answers: StructuredAnswer[] = [];
  const open = request();
  const view = conversation(
    projection({ lifecycle: LIFE.WAITING_FOR_HUMAN, execution: EXEC.PAUSED, events: [...ACTIVITY, events.humanOpened(6, 14), events.execution(7, 15, EXEC.RUNNING, EXEC.PAUSED)], requests: [open] }),
    (answer) => answers.push(answer),
  );
  const question = view.querySelector(`[data-human-request="${REQUEST_ID}"]`);
  assert.ok(question);
  assert.match(question.textContent ?? "", /Is the service publicly accessible\?/);
  assert.equal(view.querySelectorAll("textarea").length, 0);
  const labels = buttons(question).map((button) => button.textContent?.trim());
  assert.deepEqual(labels, ["Yes", "No", "I don't know"]);
  click(byText(question, "button", "Yes"));
  click(byText(question, "button", "I don't know"));
  assert.deepEqual(answers, [{ doesNotKnow: false, answer: "yes" }, { doesNotKnow: true }]);
});

test("a free-text request renders a composer-style field, a multi-choice one explicit selectable options", async () => {
  const text = conversation(
    projection({ lifecycle: LIFE.WAITING_FOR_HUMAN, execution: EXEC.PAUSED, events: [...ACTIVITY, events.humanOpened(6, 14)], requests: [request("OPEN", { controlType: HUMAN_RESOLUTION_CONTROL_TYPES.FREE_TEXT, choices: [] })] }),
  );
  assert.equal(text.querySelectorAll("textarea").length, 1);
  assert.ok(text.querySelector('button[type="submit"]'));
  assert.ok(byText(text, "button", "I don't know"));

  const multi = conversation(
    projection({ lifecycle: LIFE.WAITING_FOR_HUMAN, execution: EXEC.PAUSED, events: [...ACTIVITY, events.humanOpened(6, 14)], requests: [request("OPEN", { controlType: "MULTI_SELECT", choices: [{ value: "eu", label: "EU" }, { value: "us", label: "US" }, { value: "vn", label: "VN" }] })] }),
  );
  const boxes = [...multi.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  assert.equal(boxes.length, 3);
  const submit = byText(multi, "button", "Submit") as HTMLButtonElement | null;
  assert.ok(submit);
  assert.equal(submit.disabled, true, "nothing selected yet");
  boxes.forEach((box) => assert.equal(box.type, "checkbox"));
});

test("the accepted answer stays in the thread, coherent after a reload", () => {
  const answered = request("RESOLVED", {
    resolvedFactId: "12121212-1212-4121-8121-121212121212",
    answers: [{
      idempotencyKey: "answer-key-1",
      requestDigest: "d".repeat(64),
      actorId: "owner-1",
      answeredAt: new Date(Date.UTC(2026, 9, 11, 10, 0, 20)).toISOString(),
      caseRevision: 1,
      requestRevision: 1,
      doesNotKnow: false,
      answer: "Yes",
    }],
  });
  const input = {
    lifecycle: LIFE.ACTIVE,
    execution: EXEC.RUNNING,
    events: [...ACTIVITY, events.humanOpened(6, 14), events.execution(7, 15, EXEC.RUNNING, EXEC.PAUSED), events.execution(8, 22, EXEC.PAUSED, EXEC.RUNNING)],
    requests: [answered],
  };
  const first = conversation(projection(input));
  const reloaded = conversation(projection(input));
  const bubble = first.querySelector('[data-role="user"]');
  assert.ok(bubble);
  assert.equal(bubble.textContent?.trim(), "YouYes");
  assert.equal(first.querySelectorAll("button").length, 0, "no stale answer control after the answer");
  assert.equal(reloaded.innerHTML, first.innerHTML, "live view and reload share one projection");
});

test("an accepted decision reads as assistant output with evidence and technical details behind expanders", () => {
  const view = conversation(projection({ decisions: true, events: [...ACTIVITY, events.decision(6, 14)] }));
  const decision = view.querySelector('[data-turn-kind="DECISION"]');
  assert.ok(decision);
  assert.match(decision.textContent ?? "", /Notice retention/);
  assert.match(decision.textContent ?? "", /Non-compliant/);
  assert.match(decision.textContent ?? "", /Deletion is based on the draft timestamp/);
  const expanders = [...decision.querySelectorAll<HTMLDetailsElement>("details")];
  assert.ok(expanders.length >= 3);
  assert.ok(expanders.every((item) => !item.open));
});

test("Stop is an interaction-bar action: it posts the stop for the CURRENT execution", async () => {
  const running = detail();
  const stub = installFetch({
    [`GET /api/assessments/${ASSESSMENT_ID}/runtime/control`]: null,
    [`POST /api/assessments/${ASSESSMENT_ID}/runtime/stop`]: { state: "STOP_REQUESTED", targetRunId: EXECUTION_ID, assessmentId: ASSESSMENT_ID },
  });
  try {
    const view = render(
      withClient(<AssessmentInteractionBar assessment={running} state={customerAssessmentState(running.lifecycle, running.runtime)} onRefresh={noop} />),
    );
    await settle();
    assert.match(view.textContent ?? "", /Assessment Root is working…/);
    const stop = view.querySelector('[data-runtime-action="stop"]');
    assert.ok(stop);
    click(stop);
    await settle();
    const post = stub.calls.find((call) => call.method === "POST");
    assert.ok(post, "Stop must actually be sent");
    assert.match(post.url, /\/runtime\/stop$/);
    assert.match(post.body ?? "", new RegExp(EXECUTION_ID));
  } finally {
    stub.restore();
  }
});

test("an ACTIVE queued assessment without an execution offers canonical orphan reconciliation", async () => {
  const queued = detail({ execution: EXEC.QUEUED });
  const orphan = {
    ...queued,
    runtime: {
      ...queued.runtime!,
      currentExecutionId: null,
      checkpointId: null,
    },
  };
  const stub = installFetch({
    [`GET /api/assessments/${ASSESSMENT_ID}/runtime/control`]: null,
    [`POST /api/assessments/${ASSESSMENT_ID}/reconcile-orphaned`]: {
      assessmentId: ASSESSMENT_ID,
      state: LIFE.CANCELLED,
      reconciled: true,
    },
  });
  try {
    const view = render(
      withClient(
        <AssessmentInteractionBar
          assessment={orphan}
          state={customerAssessmentState(orphan.lifecycle, orphan.runtime)}
          onRefresh={noop}
        />,
      ),
    );
    await settle();
    assert.equal(view.querySelectorAll(".animate-spin").length, 0);
    const reconcile = view.querySelector(
      '[data-runtime-action="reconcile-orphaned"]',
    );
    assert.ok(reconcile);
    click(reconcile);
    await settle();
    assert.match(
      stub.calls.find((call) => call.method === "POST")?.url ?? "",
      /\/reconcile-orphaned$/,
    );
  } finally {
    stub.restore();
  }
});

test("a failed execution in an ACTIVE assessment shows failure and Refresh without a spinner or automatic retry", async () => {
  const failed = detail({ lifecycle: LIFE.ACTIVE, execution: EXEC.FAILED });
  const stub = installFetch({
    [`GET /api/assessments/${ASSESSMENT_ID}`]: failed,
    [`GET /api/assessments/${ASSESSMENT_ID}/repository-setup`]: null,
    [`GET /api/assessments/${ASSESSMENT_ID}/runtime/control`]: null,
  });
  let refreshed = 0;
  try {
    const view = render(
      withClient(
        <>
          <AssessmentContextPanel assessmentId={ASSESSMENT_ID} />
          <AssessmentInteractionBar
            assessment={failed}
            state={customerAssessmentState(failed.lifecycle, failed.runtime)}
            onRefresh={() => refreshed++}
          />
        </>,
      ),
    );
    await settle();
    const bar = view.querySelector('[data-slot="chat-interaction-bar"]');
    const panel = view.querySelector('[data-slot="assessment-context"]');
    assert.ok(bar && panel);
    assert.match(bar.textContent ?? "", /This assessment run failed\./);
    assert.doesNotMatch(panel.textContent ?? "", /Working/);
    assert.equal(view.querySelectorAll(".animate-spin").length, 0);
    assert.equal(view.querySelectorAll("[data-runtime-action]").length, 0);
    click(byText(bar, "button", "Refresh"));
    await settle();
    assert.equal(refreshed, 1);
    assert.equal(stub.calls.filter((call) => call.method === "POST").length, 0);
    assert.equal(failed.lifecycle?.state, LIFE.ACTIVE);
  } finally {
    stub.restore();
  }
});

test("PAUSED shows Continue next to the thread, and no spinner", async () => {
  const paused = detail({ lifecycle: LIFE.PAUSED, execution: EXEC.PAUSED });
  const stub = installFetch({
    [`GET /api/assessments/${ASSESSMENT_ID}/runtime/control`]: null,
    [`POST /api/assessments/${ASSESSMENT_ID}/runtime/continue`]: { state: "RESUME_REQUESTED", targetRunId: EXECUTION_ID, assessmentId: ASSESSMENT_ID },
  });
  try {
    const view = render(
      withClient(<AssessmentInteractionBar assessment={paused} state={customerAssessmentState(paused.lifecycle, paused.runtime)} onRefresh={noop} />),
    );
    await settle();
    assert.equal(view.querySelectorAll(".animate-spin").length, 0);
    const resume = view.querySelector('[data-runtime-action="continue"]');
    assert.ok(resume);
    assert.match(resume.textContent ?? "", /Continue assessment/);
    click(resume);
    await settle();
    assert.match(stub.calls.find((call) => call.method === "POST")?.url ?? "", /\/runtime\/continue$/);
  } finally {
    stub.restore();
  }
});

test("a question that is waiting shows a quiet note instead of Stop or Continue", async () => {
  const waiting = detail({ lifecycle: LIFE.WAITING_FOR_HUMAN, execution: EXEC.PAUSED });
  const stub = installFetch({ [`GET /api/assessments/${ASSESSMENT_ID}/runtime/control`]: null });
  try {
    const view = render(
      withClient(<AssessmentInteractionBar assessment={waiting} state={customerAssessmentState(waiting.lifecycle, waiting.runtime)} onRefresh={noop} />),
    );
    await settle();
    assert.match(view.textContent ?? "", /Answer the question above to continue/);
    assert.equal(view.querySelectorAll("[data-runtime-action]").length, 0);
  } finally {
    stub.restore();
  }
});

test("COMPLETE: one completion message with the summary and report actions, no spinner", async () => {
  const complete = detail({ lifecycle: LIFE.COMPLETE, execution: EXEC.SUCCEEDED, decisions: true, artifact: true });
  const value = projection({
    lifecycle: LIFE.COMPLETE,
    execution: EXEC.SUCCEEDED,
    decisions: true,
    artifact: true,
    events: [...ACTIVITY, events.decision(6, 14), events.lifecycle(7, 20, LIFE.ACTIVE, LIFE.FINALIZING), events.lifecycle(8, 30, LIFE.FINALIZING, LIFE.COMPLETE)],
  });
  const stub = installFetch({ [`GET /api/assessments/${ASSESSMENT_ID}/runtime/control`]: null });
  try {
    const view = render(
      withClient(
        <div>
          <AssessmentConversation projection={value} answerPending={false} answerFailed={false} onAnswer={noop} />
          <AssessmentInteractionBar assessment={complete} state={customerAssessmentState(complete.lifecycle, complete.runtime)} onRefresh={noop} />
        </div>,
      ),
    );
    await settle();
    const turn = view.querySelector('[data-slot="completion-turn"]');
    assert.ok(turn);
    assert.match(turn.textContent ?? "", /Assessment complete\./);
    assert.match(turn.textContent ?? "", /1 assessment rules evaluated/);
    assert.match(turn.textContent ?? "", /1 non-compliant/);
    const download = turn.querySelector<HTMLAnchorElement>('[data-report-action="download"]');
    assert.equal(download?.getAttribute("href"), `/api/assessments/${ASSESSMENT_ID}/artifacts/${ARTIFACT_ID}/download`);
    const viewLink = turn.querySelector<HTMLAnchorElement>('[data-report-action="view"]');
    assert.equal(viewLink?.getAttribute("href"), `/assessments/${ASSESSMENT_ID}/report?artifactId=${ARTIFACT_ID}`);
    assert.equal(view.querySelectorAll(".animate-spin").length, 0);
    assert.match(view.querySelector('[data-slot="chat-interaction-bar"]')?.textContent ?? "", /Assessment complete/);
  } finally {
    stub.restore();
  }
});

test("usage is aggregated once at each level: step -> turn here, assessment total only in the sidebar", () => {
  const view = conversation(projection());
  const turn = view.querySelector('[data-slot="work-disclosure"]');
  assert.ok(turn);
  // 100+20 and 200+30 tokens: the inspection group carries 350, the turn carries the same 350.
  const totals = [...(turn.textContent ?? "").matchAll(/350 tokens/g)];
  assert.equal(totals.length, 2, "group total and turn total, each exactly once");
  assert.equal((turn.textContent ?? "").includes("700 tokens"), false, "never double counted");
});

test("the layout stays a readable, contained chat column on desktop, tablet and phone", async () => {
  const { readFile } = await import("node:fs/promises");
  const read = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
  const [slots, transcript, bar, shell, view] = await Promise.all([
    read("features/workspace/components/organisms/assessment-shell-slots.tsx"),
    read("features/workspace/components/organisms/assessment-transcript.tsx"),
    read("components/molecules/chat-interaction-bar.tsx"),
    read("features/workspace/components/organisms/assessment-app-shell.tsx"),
    read("features/assessment-runtime/components/organisms/assessment-chat-view.tsx"),
  ]);
  assert.match(slots, /max-w-3xl/, "reading width ~768px, not the full viewport");
  assert.match(transcript, /max-w-3xl min-w-0/);
  assert.match(transcript, /overflow-x-hidden/);
  assert.match(slots, /w-80 shrink-0[^"]*xl:flex/, "compact context panel only on wide screens");
  assert.match(shell, /<Sheet open=\{mobileRuntimeOpen\}/, "context is a sheet on tablet and phone");
  assert.match(shell, /className="xl:hidden"/);
  assert.match(bar, /sticky bottom-0/);
  assert.match(view, /aria-live="polite" className="sr-only"/, "a status region speaks; the log stays quiet");
  assert.doesNotMatch(`${slots}${bar}`, /(?:min-|max-)?w-\[\d{3,}px\]/);
});

test("request deep-link target renders as a focusable element with tabIndex=-1 and disables transcript auto-scroll", () => {
  const req1Id = "11111111-1111-4111-8111-111111111111";
  const req2Id = "22222222-2222-4222-8222-222222222222";
  const req1 = request("OPEN", {
    requestId: req1Id,
    question: "First question?",
  });
  const req2 = request("OPEN", {
    requestId: req2Id,
    question: "Second question?",
  });
  const proj = projectConversation({
    assessmentId: ASSESSMENT_ID,
    events: ACTIVITY,
    detail: detail(),
    requests: [req1, req2],
    repository: REPOSITORY,
  });

  const view = render(
    <AssessmentConversation
      projection={proj}
      answerPending={false}
      answerFailed={false}
      onAnswer={noop}
      targetRequestId={req2Id}
    />,
  );

  const targetEl = view.querySelector<HTMLElement>(
    `[data-human-request="${req2Id}"]`,
  );
  assert.ok(targetEl, "target request element must exist");
  assert.equal(
    targetEl.getAttribute("tabindex"),
    "-1",
    "target request must be focusable via tabIndex=-1",
  );
  assert.ok(
    targetEl.className.includes("focus-visible:ring-2"),
    "must have focus-visible styling",
  );

  const otherEl = view.querySelector<HTMLElement>(
    `[data-human-request="${req1Id}"]`,
  );
  assert.ok(otherEl, "other request element also renders");
  assert.equal(otherEl.getAttribute("tabindex"), "-1");
});

test("multiple open human requests route submission strictly to their own request ID", async () => {
  const req1Id = "11111111-1111-4111-8111-111111111111";
  const req2Id = "22222222-2222-4222-8222-222222222222";
    const req1 = request("OPEN", {
      requestId: req1Id,
      question: "First question?",
      choices: [{ label: "Choice A", value: "val-a" }],
    });
    const req2 = request("OPEN", {
      requestId: req2Id,
      question: "Second question?",
      choices: [{ label: "Choice B", value: "val-b" }],
    });
    const proj = projectConversation({
      assessmentId: ASSESSMENT_ID,
      events: ACTIVITY,
      detail: detail(),
      requests: [req1, req2],
      repository: REPOSITORY,
    });

    const submitted: Array<{ answer: StructuredAnswer; requestId: string }> = [];
    const handleAnswer = (
      answer: StructuredAnswer,
      req: { requestId: string },
    ) => {
      submitted.push({ answer, requestId: req.requestId });
    };

    const view = render(
      <AssessmentConversation
        projection={proj}
        answerPending={false}
        answerFailed={false}
        onAnswer={handleAnswer as unknown as Parameters<typeof AssessmentConversation>[0]["onAnswer"]}
        targetRequestId={req2Id}
      />,
    );

    // Click choice A under Question 1
    const req1El = view.querySelector<HTMLElement>(
      `[data-human-request="${req1Id}"]`,
    );
    assert.ok(req1El, "request 1 container exists");
    const btn1 = byText<HTMLButtonElement>(req1El, "button", /Choice A/);
    assert.ok(btn1, "choice button A exists");
    click(btn1);

    assert.equal(submitted.length, 1);
    assert.equal(
      submitted[0].requestId,
      req1Id,
      "submitting question 1 must write to request 1, even if deep-linked to request 2",
    );
    assert.equal(submitted[0].answer.doesNotKnow, false);

    // Click choice B under Question 2
    const req2El = view.querySelector<HTMLElement>(
      `[data-human-request="${req2Id}"]`,
    );
    assert.ok(req2El, "request 2 container exists");
    const btn2 = byText<HTMLButtonElement>(req2El, "button", /Choice B/);
    assert.ok(btn2, "choice button B exists");
    click(btn2);

    assert.equal(submitted.length, 2);
    assert.equal(
      submitted[1].requestId,
      req2Id,
      "submitting question 2 must write to request 2",
    );
});

