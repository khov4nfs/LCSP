import { describe, expect, it } from "@jest/globals";
import {
  inspectHumanFactAnswer,
  reusableHumanFactId,
} from "./human-fact-integrity.js";

const incident =
  "Has any serious AI-system incident occurred during operation of the chatbot?";
const breach =
  "Has any personal data breach involving location data or biometric data occurred?";
const level =
  "What is the information-system security-level classification, if any, of the website?";

describe("HITL high-impact fact integrity", () => {
  it("does not turn unknown incident history into a definitive accepted fact", () => {
    expect(
      inspectHumanFactAnswer(
        incident,
        "No signed incident or complaint register has been provided. Incident history remains unknown.",
        [],
      ),
    ).toBe("UNKNOWN_ANSWER_MUST_USE_DOES_NOT_KNOW");
  });
  it("detects T31 mixed no-incident and unknown status", () => {
    expect(
      inspectHumanFactAnswer(
        incident,
        "No serious incident has occurred. The incident status remains unknown.",
        [],
      ),
    ).toBe("AMBIGUOUS_HUMAN_ANSWER");
  });
  it("rejects a definitive no after the same incident was explicitly unknown", () => {
    expect(
      inspectHumanFactAnswer(
        incident,
        "No, no serious incident has occurred since go-live.",
        [
          {
            question: incident,
            answer: "No confirmed incident register. Status remains unknown.",
          },
        ],
      ),
    ).toBe("CONTRADICTS_PRIOR_HUMAN_FACT");
  });
  it("detects an inconsistent cybersecurity classification and equivalent level", () => {
    expect(
      inspectHumanFactAnswer(
        level,
        "No formal classification has been performed, but the system is classified as Level 1.",
        [],
      ),
    ).toBe("AMBIGUOUS_HUMAN_ANSWER");
  });
  it("rejects replacing unknown formal level with definitive Level 1", () => {
    expect(
      inspectHumanFactAnswer(level, "The system is classified as Level 1.", [
        {
          question: level,
          answer: "The formal security-level classification is unknown.",
        },
      ]),
    ).toBe("CONTRADICTS_PRIOR_HUMAN_FACT");
  });
  it("blocks unknown sensitive-data breach claims", () => {
    expect(
      inspectHumanFactAnswer(
        breach,
        "No confirmed breach register was provided, so breach history remains unknown.",
        [],
      ),
    ).toBe("UNKNOWN_ANSWER_MUST_USE_DOES_NOT_KNOW");
  });
  it("reuses existing narrow-topic facts without opening another HITL request", () => {
    expect(
      reusableHumanFactId(
        " HAS ANY SERIOUS AI-SYSTEM INCIDENT OCCURRED DURING OPERATION OF THE CHATBOT? ",
        [
          {
            question:
              "Has any serious AI-system incident occurred during operation of the chatbot?",
            resolvedFactId: "incident-fact",
          },
        ],
      ),
    ).toBe("incident-fact");
    expect(
      reusableHumanFactId("Who is the data controller?", [
        {
          question:
            "Has any serious AI-system incident occurred during operation of the chatbot?",
          resolvedFactId: "incident-fact",
        },
      ]),
    ).toBeNull();
  });

  it("leaves unrelated and consistently negative customer responses unchanged", () => {
    expect(
      inspectHumanFactAnswer(
        "What is your registered company address?",
        "Unknown at present",
        [],
      ),
    ).toBeNull();
    expect(
      inspectHumanFactAnswer(
        incident,
        "No, no serious incident has occurred.",
        [{ question: incident, answer: "No serious incident has occurred." }],
      ),
    ).toBeNull();
  });
});
