import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  ASSESSMENT_INTERVIEW_OUTCOMES,
  ASSESSMENT_INTERVIEW_CONTROLS,
} from "@lcsp/contracts/evidence";
import { ASSESSMENT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";

import {
  CANONICAL_INTERVIEW_PRESENTATION_STATES,
  selectCanonicalInterviewPresentation,
} from "../src/features/workspace/utils/canonical-interview-presentation.ts";
import {
  composerModeForAnswerMode,
  deriveInterviewAnswerMode,
  INTERVIEW_ANSWER_MODES,
  INTERVIEW_COMPOSER_MODES,
} from "../src/features/workspace/utils/interview-answer-mode.ts";

const overviewPath = new URL(
  "../src/features/workspace/components/organisms/assessment-overview.tsx",
  import.meta.url,
);

const question = {
  id: "question-1",
  intent: "ASK" as const,
  control: ASSESSMENT_INTERVIEW_CONTROLS.singleSelect,
  prompt: "Which workflow is used?",
  choices: [{ id: "one", label: "One" }],
};

function input(overrides: Record<string, unknown> = {}) {
  return {
    lifecycleState: ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_REQUIRED_INPUT,
    interview: {
      outcome: ASSESSMENT_INTERVIEW_OUTCOMES.waitingForCustomer,
      activeQuestion: question,
      answerHistory: [],
      stale: false,
      revalidating: false,
    },
    customerActions: { canAnswerQuestion: true },
    queryPending: false,
    queryError: false,
    canonicalAvailable: true,
    ...overrides,
  } as Parameters<typeof selectCanonicalInterviewPresentation>[0];
}

test("canonical Interview is interactive-eligible only when canonical and Interview gates agree", () => {
  assert.equal(
    selectCanonicalInterviewPresentation(input()).state,
    CANONICAL_INTERVIEW_PRESENTATION_STATES.interactiveEligible,
  );
  assert.equal(
    selectCanonicalInterviewPresentation(
      input({ customerActions: { canAnswerQuestion: false } }),
    ).state,
    CANONICAL_INTERVIEW_PRESENTATION_STATES.readOnly,
  );
});

test("canonical answer-mode policy keeps required text on the shared structured action", () => {
  const modes = [
    [
      ASSESSMENT_INTERVIEW_CONTROLS.freeText,
      false,
      INTERVIEW_ANSWER_MODES.freeText,
      INTERVIEW_COMPOSER_MODES.freeText,
    ],
    [
      ASSESSMENT_INTERVIEW_CONTROLS.singleSelect,
      false,
      INTERVIEW_ANSWER_MODES.structuredSelection,
      INTERVIEW_COMPOSER_MODES.disabled,
    ],
    [
      ASSESSMENT_INTERVIEW_CONTROLS.singleSelect,
      true,
      INTERVIEW_ANSWER_MODES.structuredSelectionWithText,
      INTERVIEW_COMPOSER_MODES.requiredSelectionText,
    ],
    [
      ASSESSMENT_INTERVIEW_CONTROLS.multiSelect,
      true,
      INTERVIEW_ANSWER_MODES.structuredSelectionWithText,
      INTERVIEW_COMPOSER_MODES.requiredSelectionText,
    ],
  ] as const;

  for (const [control, requiresText, expectedMode, expectedComposer] of modes) {
    const mode = deriveInterviewAnswerMode({
      question: { ...question, control },
      selectedChoiceRequiresFreeText: requiresText,
      isAdjusting: false,
      pending: false,
      submitted: false,
      stale: false,
      revalidating: false,
      canAnswer: true,
    });
    assert.equal(mode, expectedMode);
    assert.equal(composerModeForAnswerMode(mode), expectedComposer);
  }
});

test("canonical answer-mode policy disables every capability while pending or stale", () => {
  const questionWithRequiredText = {
    ...question,
    choices: [{ id: "other", label: "Other", requiresFreeText: true }],
  };
  for (const flags of [
    { pending: true, submitted: false, stale: false, revalidating: false },
    { pending: false, submitted: true, stale: false, revalidating: false },
    { pending: false, submitted: false, stale: true, revalidating: false },
    { pending: false, submitted: false, stale: false, revalidating: true },
  ]) {
    const mode = deriveInterviewAnswerMode({
      question: questionWithRequiredText,
      selectedChoiceRequiresFreeText: true,
      isAdjusting: false,
      canAnswer: true,
      ...flags,
    });
    assert.equal(mode, INTERVIEW_ANSWER_MODES.disabled);
    assert.equal(
      composerModeForAnswerMode(mode),
      INTERVIEW_COMPOSER_MODES.disabled,
    );
  }
});

test("preparing and missing Interview content stay hidden", () => {
  assert.equal(
    selectCanonicalInterviewPresentation(
      input({ lifecycleState: ASSESSMENT_LIFECYCLE_STATES.PREPARING }),
    ).state,
    CANONICAL_INTERVIEW_PRESENTATION_STATES.hidden,
  );
  assert.equal(
    selectCanonicalInterviewPresentation(
      input({ interview: { ...input().interview, activeQuestion: null } }),
    ).state,
    CANONICAL_INTERVIEW_PRESENTATION_STATES.hidden,
  );
});

test("stale, revalidating and terminal Interview state remains read-only when content exists", () => {
  for (const interview of [
    { ...input().interview, stale: true },
    { ...input().interview, revalidating: true },
  ]) {
    assert.equal(
      selectCanonicalInterviewPresentation(input({ interview })).state,
      CANONICAL_INTERVIEW_PRESENTATION_STATES.readOnly,
    );
  }
  assert.equal(
    selectCanonicalInterviewPresentation(
      input({ lifecycleState: ASSESSMENT_LIFECYCLE_STATES.COMPLETE }),
    ).state,
    CANONICAL_INTERVIEW_PRESENTATION_STATES.readOnly,
  );
  for (const lifecycleState of [
    ASSESSMENT_LIFECYCLE_STATES.PAUSED,
    ASSESSMENT_LIFECYCLE_STATES.BLOCKED,
    ASSESSMENT_LIFECYCLE_STATES.FAILED,
    ASSESSMENT_LIFECYCLE_STATES.CANCELLED,
  ]) {
    assert.equal(
      selectCanonicalInterviewPresentation(input({ lifecycleState })).state,
      CANONICAL_INTERVIEW_PRESENTATION_STATES.readOnly,
    );
  }
});

test("history keeps the panel visible without fabricating an active question", () => {
  const history = [
    {
      questionId: "question-0",
      answeredAt: "2026-10-08T00:00:00.000Z",
      summary: "The workflow is reviewed.",
    },
  ];
  const presentation = selectCanonicalInterviewPresentation(
    input({
      interview: {
        ...input().interview,
        activeQuestion: null,
        outcome: ASSESSMENT_INTERVIEW_OUTCOMES.contextReady,
        answerHistory: history,
      },
    }),
  );
  assert.equal(presentation.state, CANONICAL_INTERVIEW_PRESENTATION_STATES.readOnly);
  assert.equal(presentation.activeQuestion, null);
  assert.deepEqual(presentation.answerHistory, history);
});

test("canonical AssessmentOverview mounts the Interview boundary without restoring the retired flow", async () => {
  const source = await readFile(overviewPath, "utf8");
  assert.match(source, /<CanonicalInterviewPanel/);
  assert.match(source, /lifecycleState=\{assessment\.lifecycle\.state\}/);
  assert.doesNotMatch(source, /AssessmentInterviewFlow/);
});
