import { describe, expect, it } from "@jest/globals";
import {
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
  RULE_DECISION_CRITERION_OUTCOMES,
  RULE_DECISION_REFERENCE_TYPES,
  ruleDecisionSchema,
  type RuleDecision,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_DECISION_SCOPE,
  DECISION_VALIDATION_FAILURE_CODES as FAIL,
} from "@lcsp/contracts/assessment-domain";

import {
  validateRuleDecision,
  type DecisionValidationContext,
} from "./decision-validator.js";

const ids = {
  portfolio: "11111111-1111-4111-8111-111111111111",
  snapshot: "66666666-6666-4666-8666-666666666666",
  evidence: "22222222-2222-4222-8222-222222222222",
  fact: "33333333-3333-4333-8333-333333333333",
};
const COMMIT = "a".repeat(40);

const context = (): DecisionValidationContext => ({
  caseRevision: 3,
  pins: {
    legalPortfolioVersionId: ids.portfolio,
    repositorySnapshotId: ids.snapshot,
    repositoryCommit: COMMIT,
  },
  rule: {
    engineeringRuleId: "ER-RET",
    engineeringRuleVersion: "v1",
    criterionIds: new Set(["C-1", "C-2"]),
    legalContextIds: new Set(["LR-RET", "LR-EXC"]),
  },
  evidence: new Map([
    [ids.evidence, { state: "ACCEPTED", repositoryCommit: COMMIT }],
  ]),
  facts: new Map([[ids.fact, { state: "ACCEPTED", caseRevision: 2 }]]),
});

const evidenceRef = {
  type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
  evidenceId: ids.evidence,
} as const;
const factRef = {
  type: RULE_DECISION_REFERENCE_TYPES.CONFIRMED_FACT,
  factId: ids.fact,
  caseRevision: 3,
} as const;

function applicable(
  overrides: Partial<Record<string, unknown>> = {},
): RuleDecision {
  return ruleDecisionSchema.parse({
    engineeringRuleId: "ER-RET",
    engineeringRuleVersion: "v1",
    scopeId: ASSESSMENT_DECISION_SCOPE,
    legalPortfolioVersionId: ids.portfolio,
    repositorySnapshotId: ids.snapshot,
    repositoryCommit: COMMIT,
    caseRevision: 3,
    legalContextRefs: [{ legalContextId: "LR-RET" }],
    applicability: RULE_DECISION_APPLICABILITIES.APPLICABLE,
    rationale: "The retention duty applies to production records.",
    references: [evidenceRef],
    criteria: ["C-1", "C-2"].map((criterionId) => ({
      criterionId,
      outcome: RULE_DECISION_CRITERION_OUTCOMES.MET,
      rationale: "Verified in source.",
      references: [evidenceRef, factRef],
    })),
    compliance: RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT,
    ...overrides,
  });
}

const codes = (decision: RuleDecision, ctx = context()) =>
  validateRuleDecision(decision, ctx).map((failure) => failure.code);

describe("validateRuleDecision (identity and provenance only)", () => {
  it("accepts a complete, correctly pinned decision without judging it", () => {
    expect(codes(applicable())).toEqual([]);
    // The validator never second-guesses meaning: a NON_COMPLIANT, a COMPLIANT and a
    // NOT_APPLICABLE decision with valid references are all accepted.
    expect(
      codes(
        applicable({
          criteria: [
            {
              criterionId: "C-1",
              outcome: RULE_DECISION_CRITERION_OUTCOMES.NOT_MET,
              rationale: "Missing.",
              references: [evidenceRef],
            },
            {
              criterionId: "C-2",
              outcome: RULE_DECISION_CRITERION_OUTCOMES.MET,
              rationale: "Ok.",
              references: [evidenceRef],
            },
          ],
          compliance: RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT,
        }),
      ),
    ).toEqual([]);
    expect(
      codes(
        applicable({
          applicability: RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE,
          criteria: [],
          compliance: null,
        }),
      ),
    ).toEqual([]);
  });

  it("rejects an unknown rule, a version mismatch and unknown legal context", () => {
    const ctx = { ...context(), rule: null };
    expect(codes(applicable(), ctx)).toContain(FAIL.UNKNOWN_ENGINEERING_RULE);
    expect(codes(applicable({ engineeringRuleVersion: "v2" }))).toContain(
      FAIL.ENGINEERING_RULE_VERSION_MISMATCH,
    );
    expect(
      codes(applicable({ legalContextRefs: [{ legalContextId: "LR-OTHER" }] })),
    ).toContain(FAIL.UNKNOWN_LEGAL_CONTEXT);
  });

  it("rejects incomplete and foreign criteria for an applicable rule", () => {
    const one = applicable().criteria.slice(0, 1);
    expect(codes(applicable({ criteria: one }))).toContain(
      FAIL.CRITERIA_INCOMPLETE,
    );
    const extra = [
      ...applicable().criteria,
      {
        criterionId: "C-9",
        outcome: RULE_DECISION_CRITERION_OUTCOMES.MET,
        rationale: "x",
        references: [evidenceRef],
      },
    ];
    expect(codes(applicable({ criteria: extra }))).toContain(
      FAIL.UNKNOWN_CRITERION,
    );
  });

  it("rejects stale pins and revisions", () => {
    expect(
      codes(
        applicable({
          legalPortfolioVersionId: "44444444-4444-4444-8444-444444444444",
        }),
      ),
    ).toContain(FAIL.PORTFOLIO_PIN_MISMATCH);
    expect(codes(applicable({ repositoryCommit: "b".repeat(40) }))).toContain(
      FAIL.REPOSITORY_PIN_MISMATCH,
    );
    expect(
      codes(
        applicable({
          caseRevision: 2,
          criteria: applicable().criteria.map((c) => ({
            ...c,
            references: [evidenceRef],
          })),
        }),
      ),
    ).toContain(FAIL.CASE_REVISION_STALE);
    expect(codes(applicable({ scopeId: "ELSEWHERE" }))).toContain(
      FAIL.UNKNOWN_SCOPE,
    );
  });

  it("rejects references that are unknown, invalidated, mispinned or from the future", () => {
    const unknown = {
      type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
      evidenceId: "55555555-5555-4555-8555-555555555555",
    } as const;
    expect(codes(applicable({ references: [unknown] }))).toContain(
      FAIL.UNKNOWN_EVIDENCE_REFERENCE,
    );
    const invalidated = context();
    invalidated.evidence = new Map([
      [ids.evidence, { state: "INVALIDATED", repositoryCommit: COMMIT }],
    ]);
    expect(codes(applicable(), invalidated)).toContain(
      FAIL.EVIDENCE_NOT_ACCEPTED,
    );
    const wrongCommit = context();
    wrongCommit.evidence = new Map([
      [ids.evidence, { state: "ACCEPTED", repositoryCommit: "c".repeat(40) }],
    ]);
    expect(codes(applicable(), wrongCommit)).toContain(
      FAIL.EVIDENCE_PIN_MISMATCH,
    );
    const futureFact = context();
    futureFact.facts = new Map([
      [ids.fact, { state: "ACCEPTED", caseRevision: 9 }],
    ]);
    expect(codes(applicable(), futureFact)).toContain(
      FAIL.FACT_REVISION_MISMATCH,
    );
    const noFact = context();
    noFact.facts = new Map();
    expect(codes(applicable(), noFact)).toContain(FAIL.UNKNOWN_FACT_REFERENCE);
  });

  it("is deterministic and never mutates its inputs", () => {
    const decision = applicable();
    const ctx = context();
    const snapshot = JSON.stringify(decision);
    expect(validateRuleDecision(decision, ctx)).toEqual(
      validateRuleDecision(decision, ctx),
    );
    expect(JSON.stringify(decision)).toBe(snapshot);
  });
});
