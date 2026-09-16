import { missingInitialPlanningContextDimensions } from "./interview-minimum-planning-context.js";

function context(
  ...statements: Array<{
    statement: string;
    topic?: string;
    normalizedValue?: unknown;
  }>
): Record<string, unknown> {
  return {
    statements: statements.map((item, index) => ({
      statementId: `stmt-${index}`,
      topic: item.topic ?? "interview_answer",
      statement: item.statement,
      normalizedValue: item.normalizedValue ?? item.statement,
    })),
  };
}

describe("missingInitialPlanningContextDimensions", () => {
  it("A: one shallow AI-usage answer does not make initial context ready", () => {
    const missing = missingInitialPlanningContextDimensions(
      context({ statement: "We use Gemini to analyze repository code." }),
    );

    expect(missing).not.toContain("aiUsage");
    expect(missing).not.toContain("dataCategories");
    expect(missing).toEqual(
      expect.arrayContaining([
        "operationalProcess",
        "decisionInfluence",
        "humanOversight",
        "affectedSubjects",
      ]),
    );
  });

  it("B: one rich answer can resolve every minimum dimension at once", () => {
    expect(
      missingInitialPlanningContextDimensions(
        context({
          statement:
            "The system uses Gemini to analyze repositories and draft compliance findings. " +
            "The findings do not automatically change customer systems or approve deployments; " +
            "a user reviews them before any remediation action. The affected process is the " +
            "compliance assessment workflow, and the analyzed material includes repository " +
            "source code and assessment metadata.",
        }),
      ),
    ).toEqual([]);
  });

  it("C: an explicit decision negative resolves only decision influence", () => {
    const missing = missingInitialPlanningContextDimensions(
      context({
        statement: "AI never directly approves, blocks, or deploys changes.",
      }),
    );

    expect(missing).not.toContain("decisionInfluence");
    expect(missing).toEqual(
      expect.arrayContaining([
        "humanOversight",
        "affectedSubjects",
        "dataCategories",
      ]),
    );
  });

  it("D: an explicit unknown answer is recorded as answered, never as a negative short-circuit", () => {
    const missing = missingInitialPlanningContextDimensions(
      context({
        topic: "decision_influence",
        statement:
          "I am not sure whether AI output can automatically trigger a workflow gate.",
        normalizedValue: "UNKNOWN",
      }),
    );

    expect(missing).not.toContain("decisionInfluence");
    expect(missing.length).toBeGreaterThan(0);
  });

  it.each([
    "There is no automated decision; people decide.",
    "No AI-driven approvals happen in this workflow.",
  ])(
    "does not treat decision-level negatives as absence of AI: %s",
    (statement) => {
      expect(
        missingInitialPlanningContextDimensions(context({ statement })),
      ).not.toEqual([]);
    },
  );

  it.each(["We do not use AI in this product.", "Chúng tôi không sử dụng AI."])(
    "treats an explicit absence of AI as ready: %s",
    (statement) => {
      expect(
        missingInitialPlanningContextDimensions(context({ statement })),
      ).toEqual([]);
    },
  );

  it("matches whole words, so embedded letters do not resolve a dimension", () => {
    const missing = missingInitialPlanningContextDimensions(
      context({ statement: "We email the detailed maintenance plan." }),
    );

    expect(missing).toContain("aiUsage");
    expect(missing).toContain("humanOversight");
  });

  it("requires every dimension when no confirmed statements exist", () => {
    expect(missingInitialPlanningContextDimensions(undefined)).toEqual([
      "aiUsage",
      "operationalProcess",
      "decisionInfluence",
      "humanOversight",
      "affectedSubjects",
      "dataCategories",
    ]);
  });
});
