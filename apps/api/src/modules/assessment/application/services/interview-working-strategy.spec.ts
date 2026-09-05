import { describe, expect, it } from "@jest/globals";
import {
  ASSESSMENT_INTERVIEW_CONTROLS,
  ASSESSMENT_INTERVIEW_QUESTION_INTENTS,
  EMPTY_INTERVIEW_WORKING_STRATEGY,
  type AssessmentInterviewAnswerInput,
  type AssessmentInterviewQuestion,
} from "@lcsp/contracts/evidence";

import { updateInterviewWorkingStrategy } from "./interview-working-strategy.js";

const question: AssessmentInterviewQuestion = {
  id: "q-1",
  intent: ASSESSMENT_INTERVIEW_QUESTION_INTENTS.ask,
  control: ASSESSMENT_INTERVIEW_CONTROLS.freeText,
  prompt: "How does approval work?",
};

describe("InterviewWorkingStrategy", () => {
  it("keeps a no-op turn unchanged", () => {
    const answer: AssessmentInterviewAnswerInput = {
      questionId: "q-1",
      freeText: "ok",
    };
    expect(
      updateInterviewWorkingStrategy({
        current: EMPTY_INTERVIEW_WORKING_STRATEGY,
        question,
        answer,
      }),
    ).toEqual(EMPTY_INTERVIEW_WORKING_STRATEGY);
  });

  it("records bounded useful turn guidance without creating business facts", () => {
    const answer: AssessmentInterviewAnswerInput = {
      questionId: "q-1",
      freeText:
        "We call approval as gate before release; the wording is clear.",
    };
    const result = updateInterviewWorkingStrategy({
      current: EMPTY_INTERVIEW_WORKING_STRATEGY,
      question,
      answer,
    });
    expect(result.avoidReaskingTopics).toEqual(["q-1"]);
    expect(result.effectiveQuestionPatterns).toEqual(["ASK:FREE_TEXT"]);
    expect(result.terminologyMap).toEqual({ approval: "gate before release" });
    expect(JSON.stringify(result)).not.toContain("We call approval");
  });

  it("deduplicates and bounds accumulated strategy", () => {
    const current = {
      ...EMPTY_INTERVIEW_WORKING_STRATEGY,
      avoidReaskingTopics: Array.from(
        { length: 40 },
        (_, index) => `q-${index}`,
      ),
    };
    const result = updateInterviewWorkingStrategy({
      current,
      question,
      answer: { questionId: "q-1", confirmed: true },
    });
    expect(result.avoidReaskingTopics).toHaveLength(20);
    expect(new Set(result.avoidReaskingTopics).size).toBe(20);
  });

  it("records ambiguity as a bounded strategy hint only", () => {
    const result = updateInterviewWorkingStrategy({
      current: EMPTY_INTERVIEW_WORKING_STRATEGY,
      question,
      answer: {
        questionId: "q-1",
        freeText:
          "The term is still unclear and we are not sure which system owns it.",
      },
    });

    expect(result.observedAmbiguities).toEqual(["Ambiguity noted for q-1."]);
    expect(result).not.toHaveProperty("confirmedContext");
  });
});
