import { WizardValidatorService } from "./wizard-validator.service.js";
import type { WizardAnswer } from "@lcsp/contracts/wizard";
import { ANSWER_STATES } from "@lcsp/contracts/wizard";

describe("WizardValidatorService", () => {
  let service: WizardValidatorService;

  beforeEach(() => {
    service = new WizardValidatorService();
  });

  it("T01: should return no errors when all critical fields are valid", () => {
    const answers = [
      {
        questionId: "businessProcess",
        value: "Customer support chatbot",
        answerState: ANSWER_STATES.answered,
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
      {
        questionId: "useCase",
        value: "Support agent drafts a customer reply",
        answerState: ANSWER_STATES.answered,
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
      {
        questionId: "primaryActors",
        value: "Support agent, customer, AI drafting service",
        answerState: ANSWER_STATES.answered,
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
      {
        questionId: "businessTrigger",
        value: "Customer submits a support request",
        answerState: ANSWER_STATES.answered,
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
      {
        questionId: "expectedOutcome",
        value: "Customer receives a staff-approved response",
        answerState: ANSWER_STATES.answered,
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
      {
        questionId: "aiPurpose",
        value: "technology",
        answerState: ANSWER_STATES.answered,
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
      {
        questionId: "autonomyLevel",
        value: "HUMAN_APPROVAL_REQUIRED",
        answerState: ANSWER_STATES.answered,
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
      {
        questionId: "dataTypes",
        value: ["customer_messages"],
        answerState: ANSWER_STATES.answered,
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
      {
        questionId: "affectedSubjects",
        value: ["employees"],
        answerState: ANSWER_STATES.answered,
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
      {
        questionId: "decisionRole",
        value: "advisory",
        answerState: ANSWER_STATES.answered,
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
      {
        questionId: "humanReview",
        value: "Human in the loop",
        answerState: ANSWER_STATES.answered,
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
      {
        questionId: "externalLlmUsage",
        value: "yes",
        answerState: ANSWER_STATES.answered,
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
    ] as WizardAnswer[];

    const errors = service.validate(answers);
    expect(errors).toHaveLength(0);
  });

  it("T02: should return error for missing businessProcess", () => {
    const errors = service.validate([]);
    expect(errors).toContainEqual({
      field: "businessProcess",
      message:
        "Please describe the primary business process of your AI system.",
    });
  });

  it("T09: should return error for missing aiPurpose", () => {
    const errors = service.validate([]);
    expect(errors).toContainEqual({
      field: "aiPurpose",
      message: "Please describe the primary purpose of your AI system.",
    });
  });

  it("T09: should return error for missing or empty dataTypes", () => {
    const errorsMissing = service.validate([]);
    expect(errorsMissing).toContainEqual({
      field: "dataTypes",
      message:
        "Please specify at least one type of data your AI system processes.",
    });

    const errorsEmpty = service.validate([
      {
        questionId: "dataTypes",
        value: [],
        answerState: ANSWER_STATES.answered,
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
    ]);
    expect(errorsEmpty).toContainEqual({
      field: "dataTypes",
      message:
        "Please specify at least one type of data your AI system processes.",
    });
  });

  it("T09: should return error for missing affectedSubjects", () => {
    const errors = service.validate([]);
    expect(errors).toContainEqual({
      field: "affectedSubjects",
      message:
        "Please describe the group of subjects affected by your AI system.",
    });
  });

  it("T09: should return error for missing decisionRole", () => {
    const errors = service.validate([]);
    expect(errors).toContainEqual({
      field: "decisionRole",
      message:
        "Please indicate whether your AI system makes autonomous decisions. Unknown is not permitted for this field.",
    });
  });

  it("T03: should return error for missing humanReview", () => {
    const errors = service.validate([]);
    expect(errors).toContainEqual({
      field: "humanReview",
      message: "Please describe the human oversight mechanism in place.",
    });
  });

  it("T09: should return error for missing externalLlmUsage", () => {
    const errors = service.validate([]);
    expect(errors).toContainEqual({
      field: "externalLlmUsage",
      message:
        "Please indicate whether your AI system uses an external AI provider.",
    });
  });

  it("T09: should return all errors when everything is missing", () => {
    const errors = service.validate([]);
    expect(errors).toHaveLength(12);
  });
});
