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
  Event: dom.window.Event,
  CustomEvent: dom.window.CustomEvent,
  React,
})) {
  Object.defineProperty(globalThis, key, { configurable: true, value });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
});

const { createRoot } = await import("react-dom/client");
const { setAppLocale } = await import("../src/lib/locale");
const { ClassificationResultPanel } =
  await import("../src/features/classification/components/molecules/classification-result-panel");
const { CLASSIFICATION_RESULT_TONES } =
  await import("../src/features/classification/config/classification-result-presentation");
const { toClassificationStatusOutcome } =
  await import("../src/lib/api/classification-client");

const roots: ReturnType<typeof createRoot>[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

function loadedViewModel(payload: Record<string, unknown>) {
  const outcome = toClassificationStatusOutcome(payload, true, 200);
  assert.equal(outcome.kind, "loaded");
  if (outcome.kind !== "loaded") throw new Error("expected loaded outcome");
  return outcome.data;
}

async function renderPanel(payload: Record<string, unknown>) {
  const viewModel = loadedViewModel(payload);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      React.createElement(ClassificationResultPanel, {
        executionState: viewModel.executionState,
        assessmentOutcome: viewModel.assessmentOutcome,
        evidenceQuality: viewModel.evidenceQuality,
      }),
    );
  });
  const datum = (slot: string) => {
    const element = container.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
    assert.ok(element, `missing ${slot}`);
    return { tone: element.dataset.tone, text: element.textContent ?? "" };
  };
  return {
    execution: datum("execution"),
    outcome: datum("assessment-outcome"),
    evidence: datum("evidence-quality"),
  };
}

function passedGuardrailPayload(summary: {
  compliant: number;
  non_compliant: number;
  unknown: number;
  total: number;
}, provenance: Record<string, number>) {
  return {
    readiness_state: { classification_locked: false },
    guardrail_status: "PASSED",
    classification_result: {
      mode: "ENGINEERING_RULE_EVALUATION",
      status: "COMPLETE",
      engineering_summary: summary,
      evaluations: [],
      limitations: [],
      observability: { provenance },
    },
  };
}

test("guardrail PASSED + completed run + zero evidence-backed claims renders Completed / Unknown / no validated evidence", async () => {
  setAppLocale("en");
  const rendered = await renderPanel(
    passedGuardrailPayload(
      { compliant: 0, non_compliant: 0, unknown: 0, total: 0 },
      {
        claim_count: 0,
        claims_with_evidence: 0,
        evaluations_with_evidence: 0,
        evaluations_with_displayable_technical_evidence: 0,
      },
    ),
  );

  assert.match(rendered.execution.text, /Assessment run\s*Completed/);
  assert.match(rendered.outcome.text, /Assessment result\s*Unknown/);
  assert.match(rendered.evidence.text, /No validated evidence-backed claim/);
  assert.equal(rendered.execution.tone, CLASSIFICATION_RESULT_TONES.neutral);
  assert.equal(rendered.outcome.tone, CLASSIFICATION_RESULT_TONES.warning);
  setAppLocale("vi");
});

test("guardrail PASSED never maps to the compliant success visual state on its own", async () => {
  const rendered = await renderPanel(
    passedGuardrailPayload(
      // A compliant count without any validated evidence-backed claim is not a verdict.
      { compliant: 2, non_compliant: 0, unknown: 0, total: 2 },
      {
        claim_count: 0,
        claims_with_evidence: 0,
        evaluations_with_evidence: 0,
        evaluations_with_displayable_technical_evidence: 0,
      },
    ),
  );

  for (const datum of [rendered.execution, rendered.outcome, rendered.evidence]) {
    assert.notEqual(datum.tone, CLASSIFICATION_RESULT_TONES.success);
  }
});

test("only an evidence-backed COMPLIANT outcome uses success styling", async () => {
  const rendered = await renderPanel(
    passedGuardrailPayload(
      { compliant: 2, non_compliant: 0, unknown: 0, total: 2 },
      {
        claim_count: 2,
        claims_with_evidence: 2,
        evaluations_with_evidence: 2,
        evaluations_with_displayable_technical_evidence: 2,
      },
    ),
  );

  assert.equal(rendered.outcome.tone, CLASSIFICATION_RESULT_TONES.success);
  assert.equal(rendered.execution.tone, CLASSIFICATION_RESULT_TONES.neutral);
});

test("NON_COMPLIANT outcome is destructive while the completed run stays neutral", async () => {
  const rendered = await renderPanel(
    passedGuardrailPayload(
      { compliant: 1, non_compliant: 1, unknown: 0, total: 2 },
      {
        claim_count: 2,
        claims_with_evidence: 2,
        evaluations_with_evidence: 2,
        evaluations_with_displayable_technical_evidence: 2,
      },
    ),
  );

  assert.equal(rendered.outcome.tone, CLASSIFICATION_RESULT_TONES.destructive);
  assert.equal(rendered.execution.tone, CLASSIFICATION_RESULT_TONES.neutral);
});

test("a failed run shows a failed execution and no assessment verdict", async () => {
  const payload = passedGuardrailPayload(
    { compliant: 1, non_compliant: 0, unknown: 0, total: 1 },
    { claim_count: 1, claims_with_evidence: 1, evaluations_with_evidence: 1 },
  );
  (payload.classification_result as Record<string, unknown>).status = "FAILED";

  const rendered = await renderPanel(payload);

  assert.equal(rendered.execution.tone, CLASSIFICATION_RESULT_TONES.destructive);
  assert.equal(rendered.outcome.tone, CLASSIFICATION_RESULT_TONES.neutral);
  assert.notEqual(rendered.outcome.tone, CLASSIFICATION_RESULT_TONES.success);
});
