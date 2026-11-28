import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AGENT_EXECUTION_STATES as EXEC,
  ASSESSMENT_LIFECYCLE_STATES as LIFE,
} from "@lcsp/contracts/assessment";
import { ASSESSMENT_RUNTIME_CONTROL_STATES as CTRL } from "@lcsp/contracts/evidence";
import { LOCALES } from "@lcsp/contracts/shared";
import { setAppLocale } from "../src/lib/locale.ts";
import { AssessmentRuntimeControls } from "../src/features/assessment-runtime/components/molecules/assessment-runtime-controls.tsx";
import {
  projectAssessmentRuntimeControl,
  RUNTIME_CONTROL_BUTTON_ACTIONS,
  RUNTIME_CONTROL_PHASES,
} from "../src/features/assessment-runtime/utils/assessment-runtime-control-projection.ts";
import {
  StructuredAnswerControl,
  toggleMultiSelectChoice,
} from "../src/features/assessment-runtime/components/molecules/structured-answer-control.tsx";
import {
  STRUCTURED_ANSWER_MODES,
  type StructuredAnswer,
} from "../src/features/assessment-runtime/types/structured-answer.types.ts";
import { byText, click, installFetch, render, settle } from "./support/dom.ts";

const ASSESSMENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RUN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STALE_RUN_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

setAppLocale(LOCALES[0]);

function withQueryClient(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

test("projectAssessmentRuntimeControl maps Running -> Pause, StopRequested -> Pausing disabled, Paused -> Resume, ResumeRequested -> Resuming disabled", () => {
  const running = projectAssessmentRuntimeControl({
    lifecycleState: LIFE.ACTIVE,
    executionState: EXEC.RUNNING,
    targetRunId: RUN_ID,
    controlResult: null,
  });
  assert.equal(running.phase, RUNTIME_CONTROL_PHASES.RUNNING);
  assert.equal(running.action, RUNTIME_CONTROL_BUTTON_ACTIONS.PAUSE);
  assert.equal(running.disabled, false);

  const pausing = projectAssessmentRuntimeControl({
    lifecycleState: LIFE.ACTIVE,
    executionState: EXEC.RUNNING,
    targetRunId: RUN_ID,
    controlResult: { state: CTRL.stopRequested, targetRunId: RUN_ID, requestId: null },
  });
  assert.equal(pausing.phase, RUNTIME_CONTROL_PHASES.PAUSING);
  assert.equal(pausing.action, RUNTIME_CONTROL_BUTTON_ACTIONS.PAUSE);
  assert.equal(pausing.disabled, true);

  const paused = projectAssessmentRuntimeControl({
    lifecycleState: LIFE.PAUSED,
    executionState: EXEC.PAUSED,
    targetRunId: RUN_ID,
    controlResult: { state: CTRL.stopped, targetRunId: RUN_ID, requestId: null },
  });
  assert.equal(paused.phase, RUNTIME_CONTROL_PHASES.PAUSED);
  assert.equal(paused.action, RUNTIME_CONTROL_BUTTON_ACTIONS.RESUME);
  assert.equal(paused.disabled, false);

  const resuming = projectAssessmentRuntimeControl({
    lifecycleState: LIFE.PAUSED,
    executionState: EXEC.PAUSED,
    targetRunId: RUN_ID,
    controlResult: { state: CTRL.resumeRequested, targetRunId: RUN_ID, requestId: null },
  });
  assert.equal(resuming.phase, RUNTIME_CONTROL_PHASES.RESUMING);
  assert.equal(resuming.action, RUNTIME_CONTROL_BUTTON_ACTIONS.RESUME);
  assert.equal(resuming.disabled, true);
});

test("projectAssessmentRuntimeControl blocks Resume on COMPLETED and material HITL wait, and ignores stale targetRunId", () => {
  const completed = projectAssessmentRuntimeControl({
    lifecycleState: LIFE.COMPLETE,
    executionState: EXEC.SUCCEEDED,
    targetRunId: RUN_ID,
  });
  assert.equal(completed.phase, RUNTIME_CONTROL_PHASES.COMPLETED);
  assert.equal(completed.action, null);

  const hitlWait = projectAssessmentRuntimeControl({
    lifecycleState: LIFE.WAITING_FOR_HUMAN,
    executionState: EXEC.PAUSED,
    targetRunId: RUN_ID,
    hasOpenHumanRequest: true,
  });
  assert.equal(hitlWait.phase, RUNTIME_CONTROL_PHASES.WAITING_FOR_HUMAN);
  assert.equal(hitlWait.action, null);
  assert.equal(hitlWait.canResume, false);

  const staleControl = projectAssessmentRuntimeControl({
    lifecycleState: LIFE.ACTIVE,
    executionState: EXEC.RUNNING,
    targetRunId: RUN_ID,
    controlResult: { state: CTRL.stopRequested, targetRunId: STALE_RUN_ID, requestId: null },
  });
  assert.equal(staleControl.phase, RUNTIME_CONTROL_PHASES.RUNNING);
  assert.equal(staleControl.disabled, false);
});

test("AssessmentRuntimeControls handles Pause -> Pausing… disabled", async () => {
  const stub = installFetch({
    [`GET /api/assessments/${ASSESSMENT_ID}/runtime/control`]: {
      state: CTRL.running,
      targetRunId: RUN_ID,
      requestId: null,
    },
    [`POST /api/assessments/${ASSESSMENT_ID}/runtime/stop`]: {
      state: CTRL.stopRequested,
      targetRunId: RUN_ID,
      requestId: null,
    },
  });
  try {
    const view = render(
      withQueryClient(
        <AssessmentRuntimeControls
          assessmentId={ASSESSMENT_ID}
          lifecycleState={LIFE.ACTIVE}
          executionState={EXEC.RUNNING}
          targetRunId={RUN_ID}
        />,
      ),
    );
    await settle();
    const pauseBtn = view.querySelector<HTMLButtonElement>('[data-runtime-action="stop"]');
    assert.ok(pauseBtn);
    assert.match(pauseBtn.textContent ?? "", /Pause/);
    assert.equal(pauseBtn.disabled, false);

    click(pauseBtn);
    await settle();
    assert.ok(
      stub.calls.some(
        (call) =>
          call.method === "POST" &&
          call.url.endsWith(`/api/assessments/${ASSESSMENT_ID}/runtime/stop`),
      ),
    );
  } finally {
    stub.restore();
  }

  const stubPausing = installFetch({
    [`GET /api/assessments/${ASSESSMENT_ID}/runtime/control`]: {
      state: CTRL.stopRequested,
      targetRunId: RUN_ID,
      requestId: null,
    },
  });
  try {
    const view = render(
      withQueryClient(
        <AssessmentRuntimeControls
          assessmentId={ASSESSMENT_ID}
          lifecycleState={LIFE.ACTIVE}
          executionState={EXEC.RUNNING}
          targetRunId={RUN_ID}
        />,
      ),
    );
    await settle();
    const pausingBtn = view.querySelector<HTMLButtonElement>('[data-runtime-action="stop"]');
    assert.ok(pausingBtn);
    assert.match(pausingBtn.textContent ?? "", /Pausing…/);
    assert.equal(pausingBtn.disabled, true);
  } finally {
    stubPausing.restore();
  }
});

test("AssessmentRuntimeControls shows recoverable error and reconciles on Refresh when mutation fails", async () => {
  let reconciled = 0;
  const stub = installFetch({
    [`GET /api/assessments/${ASSESSMENT_ID}/runtime/control`]: {
      state: CTRL.running,
      targetRunId: RUN_ID,
      requestId: null,
    },
    [`POST /api/assessments/${ASSESSMENT_ID}/runtime/stop`]: new Response(
      JSON.stringify({ ok: false, problem: { status: 409, code: "RUNTIME_CONTROL_TARGET_STALE" } }),
      { status: 409, headers: { "content-type": "application/json" } },
    ),
  });
  try {
    const view = render(
      withQueryClient(
        <AssessmentRuntimeControls
          assessmentId={ASSESSMENT_ID}
          lifecycleState={LIFE.ACTIVE}
          executionState={EXEC.RUNNING}
          targetRunId={RUN_ID}
          onReconcile={() => {
            reconciled += 1;
          }}
        />,
      ),
    );
    await settle();
    const pauseBtn = view.querySelector<HTMLButtonElement>('[data-runtime-action="stop"]');
    assert.ok(pauseBtn);
    click(pauseBtn);
    await settle();

    const alert = view.querySelector('[role="alert"]');
    assert.ok(alert);
    const refreshBtn = view.querySelector<HTMLButtonElement>('[data-runtime-action="reconcile-error"]');
    assert.ok(refreshBtn);
    click(refreshBtn);
    await settle();
    assert.equal(reconciled, 1);
  } finally {
    stub.restore();
  }
});

test("Multi-select enforces mutually exclusive None of these and displays selection count", () => {
  const choices = [
    { value: "enc", label: "Encryption at rest" },
    { value: "audit", label: "Audit logging" },
    { value: "none_of_these", label: "None of these" },
  ];

  // Selecting normal options works, then selecting None of these clears them.
  let picked = toggleMultiSelectChoice([], choices[0], choices);
  picked = toggleMultiSelectChoice(picked, choices[1], choices);
  assert.deepEqual(picked, ["enc", "audit"]);
  picked = toggleMultiSelectChoice(picked, choices[2], choices);
  assert.deepEqual(picked, ["none_of_these"]);
  // Selecting a normal option clears None of these.
  picked = toggleMultiSelectChoice(picked, choices[0], choices);
  assert.deepEqual(picked, ["enc"]);

  const submitted: StructuredAnswer[] = [];
  const view = render(
    <StructuredAnswerControl
      mode={STRUCTURED_ANSWER_MODES.MULTI_CHOICE}
      choices={choices}
      idBase="multi-test"
      onSubmit={(answer) => submitted.push(answer)}
    />,
  );
  assert.match(view.textContent ?? "", /0 selected/);
  const boxes = [...view.querySelectorAll('[role="checkbox"]')];
  assert.equal(boxes.length, 3);
  click(boxes[0]);
  click(boxes[1]);
  assert.match(view.textContent ?? "", /2 selected/);
  click(boxes[2]);
  assert.match(view.textContent ?? "", /1 selected/);
  const submitBtn = byText<HTMLButtonElement>(view, "button", "Submit answer");
  assert.ok(submitBtn);
  assert.equal(submitBtn.disabled, false);
  click(submitBtn);
  assert.deepEqual(submitted, [{ doesNotKnow: false, answer: "none_of_these" }]);
});

test("Boolean mode treats false as valid explicit answer, keeps I don't know distinct, and preserves selection on failure", () => {
  const submitted: StructuredAnswer[] = [];
  const view = render(
    <StructuredAnswerControl
      mode={STRUCTURED_ANSWER_MODES.BOOLEAN}
      choices={[
        { value: "true", label: "Yes" },
        { value: "false", label: "No" },
      ]}
      idBase="bool-test"
      failed={true}
      onSubmit={(answer) => submitted.push(answer)}
    />,
  );
  const submitBtn = byText<HTMLButtonElement>(view, "button", "Submit answer");
  assert.ok(submitBtn);
  assert.equal(submitBtn.disabled, true, "cannot submit empty boolean");

  const radios = [...view.querySelectorAll('[role="radio"]')];
  assert.equal(radios.length, 2);
  click(radios[1]); // "No" -> "false"
  assert.equal(submitBtn.disabled, false);
  click(submitBtn);
  click(byText(view, "button", "I don't know"));
  assert.deepEqual(submitted, [
    { doesNotKnow: false, answer: "false" },
    { doesNotKnow: true },
  ]);
  assert.ok(view.querySelector('[role="alert"]'));
});
