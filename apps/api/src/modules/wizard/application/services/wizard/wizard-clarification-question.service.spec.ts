import {
  ANSWER_STATES,
  WIZARD_CHECKBOX_OPTIONS,
  WIZARD_CLARIFICATION_AGENT_TARGET_KINDS,
  WIZARD_CLARIFICATION_ASK_MODES,
  WIZARD_CLARIFICATION_SCOPES,
  WIZARD_FIELD_CONTROLS,
  WIZARD_SELECT_OPTIONS,
  type WizardAnswer,
} from "@lcsp/contracts/wizard";
import { WizardClarificationQuestionService } from "./wizard-clarification-question.service.js";

const UPDATED_AT = "2026-08-23T00:00:00.000Z";

function answer(questionId: string, value: unknown): WizardAnswer {
  return {
    questionId,
    value,
    answerState: ANSWER_STATES.answered,
    updatedAt: UPDATED_AT,
  };
}

function completedBaseWizardAnswers(): WizardAnswer[] {
  return [
    answer(
      "businessProcess",
      "LCSP supports compliance teams assessing AI systems before production use.",
    ),
    answer(
      "useCase",
      "Compliance Manager creates an assessment, attaches a repository, runs a scan, and reviews evidence.",
    ),
    answer(
      "primaryActors",
      "Compliance Manager, Engineering Owner, Legal Operator, and LCSP worker services.",
    ),
    answer(
      "businessTrigger",
      "The flow starts when a Compliance Manager submits the intake wizard and triggers a repository scan.",
    ),
    answer(
      "expectedOutcome",
      "The flow produces a technical evidence report, guardrail status, and review-ready limitations.",
    ),
    answer(
      "aiPurpose",
      "AI helps plan investigation and summarize evidence against approved rules, without approving the final result.",
    ),
    answer("autonomyLevel", WIZARD_SELECT_OPTIONS.autonomyLevel[1].value),
    answer("sector", WIZARD_SELECT_OPTIONS.sector[6].value),
    answer("dataTypes", [WIZARD_CHECKBOX_OPTIONS.dataType[4]]),
    answer("affectedSubjects", [WIZARD_CHECKBOX_OPTIONS.affectedPeople[1]]),
    answer("userImpact", WIZARD_SELECT_OPTIONS.userImpact[1].value),
    answer("decisionRole", WIZARD_SELECT_OPTIONS.decisionRole[1].value),
    answer("humanReview", WIZARD_SELECT_OPTIONS.humanOversight[0].value),
    answer("externalLlmUsage", WIZARD_SELECT_OPTIONS.externalProvider[0].value),
    answer("deploymentContext", [WIZARD_CHECKBOX_OPTIONS.deploymentContext[0]]),
    answer("specialCategoryData", WIZARD_SELECT_OPTIONS.yesNoUnknown[1].value),
    answer("biometricData", WIZARD_SELECT_OPTIONS.yesNoUnknown[1].value),
    answer("highImpactIndicators", [
      WIZARD_CHECKBOX_OPTIONS.highImpactIndicators[4],
    ]),
    answer("prohibitedRiskSignals", [
      WIZARD_CHECKBOX_OPTIONS.prohibitedRiskSignals[4],
    ]),
  ];
}

describe("WizardClarificationQuestionService", () => {
  let service: WizardClarificationQuestionService;

  beforeEach(() => {
    service = new WizardClarificationQuestionService();
  });

  it("generates bounded field-routed questions from an empty wizard draft", () => {
    const result = service.generate(
      [],
      WIZARD_CLARIFICATION_ASK_MODES.wizardDraft,
      3,
    );

    expect(result.scope).toBe(WIZARD_CLARIFICATION_SCOPES.preScan);
    expect(result.questions).toHaveLength(3);
    expect(
      result.questions.map((question) => question.targetFieldName),
    ).toEqual(["businessProcess", "useCase", "primaryActors"]);
    expect(result.questions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetKind: WIZARD_CLARIFICATION_AGENT_TARGET_KINDS.wizardField,
          answerControl: WIZARD_FIELD_CONTROLS.textarea,
          routingConfidence: 1,
          evidenceRefs: [],
        }),
      ]),
    );
  });

  it("does not cap generated questions when no caller limit is provided", () => {
    const result = service.generate(
      [],
      WIZARD_CLARIFICATION_ASK_MODES.wizardDraft,
      undefined,
    );

    expect(result.questions.length).toBeGreaterThan(5);
  });

  it("does not generate pre-planner questions before the base wizard is complete", () => {
    const result = service.generate(
      [
        answer(
          "businessProcess",
          "LCSP supports compliance teams assessing AI systems before production use.",
        ),
        answer(
          "useCase",
          "Compliance Manager creates an assessment, attaches a repository, runs a scan, and reviews evidence.",
        ),
        answer(
          "primaryActors",
          "Compliance Manager, Engineering Owner, Legal Operator, and LCSP worker services.",
        ),
        answer(
          "businessTrigger",
          "The flow starts when a Compliance Manager submits the intake wizard and triggers a repository scan.",
        ),
        answer(
          "expectedOutcome",
          "The flow produces a technical evidence report, guardrail status, and review-ready limitations.",
        ),
        answer(
          "aiPurpose",
          "AI helps plan investigation and summarize evidence against approved rules, without approving the final result.",
        ),
      ],
      WIZARD_CLARIFICATION_ASK_MODES.prePlanner,
      5,
    );

    expect(result.scope).toBe(WIZARD_CLARIFICATION_SCOPES.postGraph);
    expect(result.questions).toHaveLength(0);
  });

  it("generates only deep research questions after the base wizard is complete", () => {
    const result = service.generate(
      completedBaseWizardAnswers(),
      WIZARD_CLARIFICATION_ASK_MODES.prePlanner,
      5,
    );

    expect(result.scope).toBe(WIZARD_CLARIFICATION_SCOPES.postGraph);
    expect(
      result.questions.map((question) => question.targetFieldName),
    ).toEqual([
      "postGraphContext",
      "postGraphRuleScope",
      "postGraphHumanReviewBoundary",
    ]);
    expect(
      result.questions.every(
        (question) => question.answerControl === WIZARD_FIELD_CONTROLS.textarea,
      ),
    ).toBe(true);
  });
});
