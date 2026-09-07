import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, test } from "node:test";

import {
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  FINAL_ASSESSMENT_RESULT_STATUSES,
  POST_FINDING_RUNTIME_PHASES,
  REMEDIATION_APPROVAL_STATUSES,
  REMEDIATION_DECISIONS,
  VERIFICATION_RESULT_STATUSES,
} from "@lcsp/contracts/evidence";
import { JSDOM } from "jsdom";
import React from "react";
import { act } from "react";
import type { Root } from "react-dom/client";

import {
  ARTIFACT_STATUSES,
  ARTIFACT_TYPES,
} from "../src/features/artifacts/types/artifact.types";
import {
  ASSESSMENT_ARTIFACT_AVAILABILITIES,
  type AssessmentScreenProjection,
  type NormalizedAssessmentArtifactItem,
  type NormalizedAssessmentPostFinding,
} from "../src/features/workspace/types/assessment-runtime-adapter.types";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});
const testWindow = dom.window;

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: testWindow,
});
Object.defineProperty(globalThis, "self", {
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

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const { createRoot } = await import("react-dom/client");
const { PostFindingFlowSteps } =
  await import("../src/features/workspace/components/molecules/post-finding-flow-steps");
const { SelectionHistoryRow } =
  await import("../src/features/workspace/components/molecules/selection-history-row");

const sourceRoot = new URL("../src/", import.meta.url);
const read = (path: string) => readFile(new URL(path, sourceRoot), "utf8");

const mountedRoots: Root[] = [];

type PostFindingTestState = Partial<NormalizedAssessmentPostFinding> & {
  canSelectDecision?: boolean;
  screenProjection: AssessmentScreenProjection;
};

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  testWindow.document.body.replaceChildren();
});

test("F11 code review renders activities and minimal patch artifact", async () => {
  const { container } = await renderFlow({
    phase: POST_FINDING_RUNTIME_PHASES.codeReview,
    screenProjection: "F11",
    codeReviewActivities: [
      {
        id: "review",
        label: "Reviewed missing consent guard",
        detail: "Minimal patch prepared",
        status: ASSESSMENT_RUNTIME_RUN_STATUSES.completed,
      },
    ],
  });

  assert.match(container.textContent ?? "", /Code review/);
  assert.match(container.textContent ?? "", /Reviewed missing consent guard/);
  assert.match(container.textContent ?? "", /Minimal patch prepared/);
  assert.equal(
    container
      .querySelector('[data-slot="post-finding-flow"]')
      ?.getAttribute("data-screen-projection"),
    "F11",
  );
  assert.match(
    container.textContent ?? "",
    /Remediation patch|Bản vá remediation/,
  );
});

test("F12 NEEDS_INPUT renders ChatSingleSelect with stable remediation values", async () => {
  const { container } = await renderFlow({
    phase: POST_FINDING_RUNTIME_PHASES.needsInput,
    screenProjection: "F12",
  });

  const radioGroup = container.querySelector('[role="radiogroup"]');
  assert.ok(radioGroup);

  const values = Array.from(container.querySelectorAll('[role="radio"]')).map(
    (node) => node.getAttribute("data-option-id"),
  );
  assert.deepEqual(values, [
    REMEDIATION_DECISIONS.updateGithubPat,
    REMEDIATION_DECISIONS.continueDetectedPr,
    REMEDIATION_DECISIONS.createRemediationPr,
  ]);

  const buttons = Array.from(
    container.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
  );
  assert.equal(buttons[0].disabled, false);
  assert.equal(buttons[1].disabled, false);
  assert.equal(buttons[2].disabled, false);
});

test("selecting each remediation value submits the exact runtime customer action", async () => {
  const submitted: string[] = [];
  const decisions = [
    REMEDIATION_DECISIONS.updateGithubPat,
    REMEDIATION_DECISIONS.continueDetectedPr,
    REMEDIATION_DECISIONS.createRemediationPr,
  ];

  for (const decision of decisions) {
    const { container } = await renderFlow(
      {
        phase: POST_FINDING_RUNTIME_PHASES.needsInput,
        screenProjection: "F12",
      },
      (value) => submitted.push(value),
    );
    const button = container.querySelector<HTMLButtonElement>(
      `[data-option-id="${decision}"]`,
    );
    assert.ok(button);
    await act(async () => {
      button.dispatchEvent(
        new testWindow.MouseEvent("click", { bubbles: true }),
      );
    });
  }

  assert.deepEqual(submitted, decisions);
});

test("local selection does not unlock post-finding branches before runtime persistence", async () => {
  const { container } = await renderFlow(
    {
      phase: POST_FINDING_RUNTIME_PHASES.needsInput,
      screenProjection: "F12",
      selectedDecision: null,
      detectedPullRequest: null,
      createdPullRequest: null,
      canSelectDecision: true,
    },
    () => undefined,
  );
  const createButton = container.querySelector<HTMLButtonElement>(
    `[data-option-id="${REMEDIATION_DECISIONS.createRemediationPr}"]`,
  );
  assert.ok(createButton);

  await act(async () => {
    createButton.dispatchEvent(
      new testWindow.MouseEvent("click", { bubbles: true }),
    );
  });

  assert.doesNotMatch(
    container.textContent ?? "",
    /Existing PR branch|Nhánh PR hiện có/,
  );
  assert.doesNotMatch(
    container.textContent ?? "",
    /Create PR branch|Tạo nhánh PR/,
  );
});

test("completed remediation decision renders SelectionHistoryRow and preserves prior Other history", async () => {
  const { container } = await renderElement(
    React.createElement(
      "div",
      null,
      React.createElement(SelectionHistoryRow, {
        prompt: "Risk category",
        selectedValue: "Other",
        detail: "Custom business risk",
      }),
      React.createElement(PostFindingFlowSteps, {
        artifacts: postFindingArtifacts(),
        onDecisionSelect: () => undefined,
        postFinding: postFindingState({
          phase: POST_FINDING_RUNTIME_PHASES.existingPr,
          screenProjection: "F13",
          selectedDecision: REMEDIATION_DECISIONS.continueDetectedPr,
          selectedDecisionAt: "2026-09-07T01:02:03.000Z",
        }),
      }),
    ),
  );

  const historyRows = container.querySelectorAll(
    '[data-slot="selection-history-row"]',
  );
  assert.equal(historyRows.length, 2);
  assert.match(container.textContent ?? "", /Other/);
  assert.match(container.textContent ?? "", /Custom business risk/);
  assert.match(
    container.textContent ?? "",
    /Continue with detected PR|Tiếp tục với PR đã phát hiện/,
  );
});

test("F13 existing PR branch continues into verification when runtime exposes verification", async () => {
  const { container } = await renderFlow({
    phase: POST_FINDING_RUNTIME_PHASES.existingPr,
    screenProjection: "F13",
    selectedDecision: REMEDIATION_DECISIONS.continueDetectedPr,
    detectedPullRequest: {
      number: 276,
      branch: "fix/lcsp-276",
      patchVersion: "patch-v1",
      url: "https://github.example/pr/276",
    },
    verificationActivities: [
      {
        id: "verify",
        label: "Ran policy checks",
        status: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
      },
    ],
  });

  assert.match(
    container.textContent ?? "",
    /Existing PR branch|Nhánh PR hiện có/,
  );
  assert.match(container.textContent ?? "", /Pull request #276/);
  assert.match(container.textContent ?? "", /Verification/);
  assert.match(container.textContent ?? "", /Ran policy checks/);
});

test("F14 create PR branch and F15 verification render branch and verification artifact", async () => {
  const { container } = await renderFlow({
    phase: POST_FINDING_RUNTIME_PHASES.verification,
    screenProjection: "F15",
    selectedDecision: REMEDIATION_DECISIONS.createRemediationPr,
    createdPullRequest: {
      number: 277,
      branch: "lcsp/remediation-276",
      patchVersion: "patch-v2",
    },
    verificationStatus: VERIFICATION_RESULT_STATUSES.running,
  });

  assert.match(container.textContent ?? "", /Create PR branch|Tạo nhánh PR/);
  assert.match(container.textContent ?? "", /Pull request #277/);
  assert.match(
    container.textContent ?? "",
    /Verification report|Báo cáo xác minh/,
  );
  assert.match(
    container.innerHTML,
    /documents\/verification-report-id\/download/,
  );
});

test("F16 final assessment renders terminal artifact links", async () => {
  const { container } = await renderFlow({
    phase: POST_FINDING_RUNTIME_PHASES.final,
    screenProjection: "F16",
    selectedDecision: REMEDIATION_DECISIONS.createRemediationPr,
    verificationStatus: VERIFICATION_RESULT_STATUSES.passed,
    finalResult: FINAL_ASSESSMENT_RESULT_STATUSES.verified,
  });

  assert.match(container.textContent ?? "", /Final assessment/);
  assert.match(container.textContent ?? "", /Verified|Đã xác minh/);
  assert.match(
    container.textContent ?? "",
    /Remediation patch|Bản vá remediation/,
  );
  assert.match(
    container.textContent ?? "",
    /Verification report|Báo cáo xác minh/,
  );
  assert.match(container.textContent ?? "", /Final report|Báo cáo cuối cùng/);
  assert.match(container.innerHTML, /documents\/final-report-id\/download/);
});

test("assessment overview uses the post-finding selector and shared artifact routes support post-finding documents", async () => {
  const [overview, routes, queries, client, route] = await Promise.all([
    read("features/workspace/components/organisms/assessment-overview.tsx"),
    read("features/artifacts/utils/artifact-routes.ts"),
    read("lib/api/assessment-queries.ts"),
    read("lib/api/assessment-interview-client.ts"),
    read("app/api/assessments/[id]/post-finding/decisions/route.ts"),
  ]);

  assert.match(overview, /selectPostFindingPresentation\(normalized\)/);
  assert.match(overview, /useSubmitAssessmentPostFindingDecisionMutation/);
  assert.match(overview, /<PostFindingFlowSteps/);
  assert.match(overview, /onDecisionSelect=\{handlePostFindingDecision\}/);
  assert.match(
    overview,
    /remediationPatch: normalized\.artifacts\.remediationPatch/,
  );
  assert.match(
    overview,
    /verificationReport:\s+normalized\.artifacts\.verificationReport/,
  );
  assert.match(overview, /finalReport: normalized\.artifacts\.finalReport/);
  assert.match(
    await read(
      "features/workspace/components/molecules/chat-single-select.tsx",
    ),
    /data-option-id=\{option\.id\}/,
  );
  assert.match(routes, /ARTIFACT_TYPES\.remediationPatch/);
  assert.match(routes, /ARTIFACT_TYPES\.verificationReport/);
  assert.match(
    routes,
    /documents\/\$\{encodeURIComponent\(ref\.resourceId\)\}\/download/,
  );
  assert.match(queries, /submitAssessmentPostFindingDecision/);
  assert.match(client, /post-finding\/decisions/);
  assert.match(
    route,
    /\/assessments\/\$\{encodeURIComponent\(id\)\}\/post-finding\/decisions/,
  );
  assert.doesNotMatch(
    await read(
      "features/workspace/components/molecules/post-finding-flow-steps.tsx",
    ),
    /draftDecision|useState<RemediationDecision/,
  );
});

async function renderFlow(
  override: PostFindingTestState,
  onDecisionSelect: (
    decision: (typeof REMEDIATION_DECISIONS)[keyof typeof REMEDIATION_DECISIONS],
  ) => void = () => undefined,
) {
  return renderElement(
    React.createElement(PostFindingFlowSteps, {
      artifacts: postFindingArtifacts(),
      onDecisionSelect,
      postFinding: postFindingState(override),
    }),
  );
}

async function renderElement(element: React.ReactElement) {
  const container = testWindow.document.createElement("div");
  testWindow.document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push(root);

  try {
    await act(async () => {
      root.render(element);
    });
  } catch (error) {
    if (error instanceof AggregateError && error.errors[0] instanceof Error) {
      throw error.errors[0];
    }
    throw error;
  }

  return { container };
}

function postFindingState(
  override: PostFindingTestState,
): NormalizedAssessmentPostFinding & {
  canSelectDecision: boolean;
  screenProjection: AssessmentScreenProjection;
} {
  return {
    phase: POST_FINDING_RUNTIME_PHASES.needsInput,
    codeReviewActivities: [],
    availableDecisions: [
      REMEDIATION_DECISIONS.updateGithubPat,
      REMEDIATION_DECISIONS.continueDetectedPr,
      REMEDIATION_DECISIONS.createRemediationPr,
    ],
    selectedDecision: null,
    selectedDecisionAt: null,
    detectedPullRequest: null,
    createdPullRequest: null,
    approvalStatus: REMEDIATION_APPROVAL_STATUSES.pendingCustomer,
    approvedPatchVersion: null,
    verificationActivities: [],
    verificationStatus: null,
    finalResult: null,
    canContinueRemediation: false,
    artifacts: {},
    canSelectDecision: override.selectedDecision === undefined,
    ...override,
  };
}

function postFindingArtifacts(): {
  remediationPatch: NormalizedAssessmentArtifactItem;
  verificationReport: NormalizedAssessmentArtifactItem;
  finalReport: NormalizedAssessmentArtifactItem;
} {
  return {
    remediationPatch: artifact(
      ARTIFACT_TYPES.remediationPatch,
      "remediation-patch-id",
    ),
    verificationReport: artifact(
      ARTIFACT_TYPES.verificationReport,
      "verification-report-id",
    ),
    finalReport: artifact(ARTIFACT_TYPES.finalReport, "final-report-id"),
  };
}

function artifact(
  type:
    | typeof ARTIFACT_TYPES.remediationPatch
    | typeof ARTIFACT_TYPES.verificationReport
    | typeof ARTIFACT_TYPES.finalReport,
  resourceId: string,
): NormalizedAssessmentArtifactItem {
  return {
    ref: {
      assessmentId: "assessment-276",
      type,
      resourceId,
    },
    type,
    status: ARTIFACT_STATUSES.ready,
    category: "DURABLE_ARTIFACT",
    id: resourceId,
    kind: type,
    labelKey:
      type === ARTIFACT_TYPES.remediationPatch
        ? "artifacts.types.remediationPatch"
        : type === ARTIFACT_TYPES.verificationReport
          ? "artifacts.types.verificationReport"
          : "artifacts.types.finalReport",
    availability: ASSESSMENT_ARTIFACT_AVAILABILITIES.ready,
    customerSafeSummary: null,
  };
}
