import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  ASSESSMENT_LIFECYCLE_STATES,
  HUMAN_RESOLUTION_REQUEST_STATUSES,
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_BASIS_KINDS,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
  RULE_DECISION_CRITERION_OUTCOMES,
} from "@lcsp/contracts/assessment";
import { assertSemanticOutcome } from "./support/assessment-semantic-oracle.mjs";

const scenarios = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/assessment-root/semantic-false-positives.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

for (const { id, expected } of scenarios) {
  test(`semantic oracle rejects false compliance: ${id} (no model execution)`, () => {
    const actual =
      expected.decision === null
        ? {
            decisions: [],
            requests: [{ status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN }],
            lifecycleState: ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN,
          }
        : {
            decisions: [
              {
                ...expected,
                applicabilityBasis: [
                  {
                    kind: RULE_DECISION_BASIS_KINDS.APPLICABILITY_CONDITION,
                    finding: expected.finding,
                    references: [{}],
                  },
                ],
              },
            ],
          };
    assert.doesNotThrow(() => assertSemanticOutcome(actual, expected));
    const compliant = {
      ...expected,
      applicability: RULE_DECISION_APPLICABILITIES.APPLICABLE,
      compliance: RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT,
      criteria: (expected.criteria ?? []).map((criterion) => ({
        ...criterion,
        outcome: RULE_DECISION_CRITERION_OUTCOMES.MET,
      })),
    };
    assert.throws(() =>
      assertSemanticOutcome({ decisions: [compliant] }, expected),
    );
  });
}

test("unknown applicability cannot pass as NOT_APPLICABLE or complete without a question", () => {
  const { expected } = scenarios.find(
    ({ id }) => id === "applicability-unproven",
  );
  assert.throws(() =>
    assertSemanticOutcome(
      {
        decisions: [
          {
            applicability: RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE,
            compliance: null,
            criteria: [],
          },
        ],
      },
      expected,
    ),
  );
  assert.throws(() =>
    assertSemanticOutcome({ decisions: [], requests: [] }, expected),
  );
  assert.throws(() =>
    assertSemanticOutcome(
      {
        decisions: [],
        requests: [{ status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN }],
        lifecycleState: ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
      },
      expected,
    ),
  );
  assert.throws(() =>
    assertSemanticOutcome(
      {
        decisions: [],
        requests: [{ status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN }],
        lifecycleState: ASSESSMENT_LIFECYCLE_STATES.FAILED,
      },
      expected,
    ),
  );
});

test("partial control cannot pass when the unmet part is omitted", () => {
  const { expected } = scenarios.find(({ id }) => id === "partial-safeguard");
  assert.throws(() =>
    assertSemanticOutcome(
      { decisions: [{ ...expected, criteria: expected.criteria.slice(0, 1) }] },
      expected,
    ),
  );
});
