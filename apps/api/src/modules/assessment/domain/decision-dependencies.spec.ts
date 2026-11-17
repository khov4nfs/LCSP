import { randomUUID } from "node:crypto";
import { describe, expect, it } from "@jest/globals";
import {
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
  RULE_DECISION_CRITERION_OUTCOMES,
  RULE_DECISION_REFERENCE_TYPES,
  ruleDecisionSchema,
} from "@lcsp/contracts/assessment";
import { ASSESSMENT_DECISION_SCOPE } from "@lcsp/contracts/assessment-domain";
import {
  decisionDependencyGraphIsComplete,
  decisionDependencyIds,
} from "./decision-dependencies.js";

function fixture() {
  const evidenceId = randomUUID();
  const factId = randomUUID();
  const evidenceReference = {
    type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
    evidenceId,
  } as const;
  const factReference = {
    type: RULE_DECISION_REFERENCE_TYPES.CONFIRMED_FACT,
    factId,
    caseRevision: 2,
  } as const;
  return {
    evidenceId,
    factId,
    decision: ruleDecisionSchema.parse({
      assessmentRuleId: "RULE-DEPENDENCIES",
      assessmentRuleVersion: "1.0.0",
      scopeId: ASSESSMENT_DECISION_SCOPE,
      ruleSetVersionId: randomUUID(),
      repositorySnapshotId: randomUUID(),
      repositoryCommit: "a".repeat(40),
      caseRevision: 2,
      legalContextRefs: [{ legalContextId: "LEGAL-1" }],
      applicability: RULE_DECISION_APPLICABILITIES.APPLICABLE,
      compliance: RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT,
      rationale: "Accepted support establishes this conclusion.",
      references: [evidenceReference, factReference],
      criteria: [
        {
          criterionId: "criterion-1",
          outcome: RULE_DECISION_CRITERION_OUTCOMES.MET,
          rationale: "The same support satisfies the criterion.",
          references: [evidenceReference],
        },
      ],
    }),
  };
}

describe("decision dependency graph", () => {
  it("deduplicates direct references and accepts only an exact complete ledger", () => {
    const { decision, evidenceId, factId } = fixture();
    expect(decisionDependencyIds(decision)).toEqual({
      evidenceIds: [evidenceId],
      factIds: [factId],
    });
    expect(
      decisionDependencyGraphIsComplete(decision, {
        dependencyGraphComplete: true,
        evidenceDependencies: [{ evidenceId }],
        factDependencies: [{ factId }],
      }),
    ).toBe(true);
  });

  it("fails closed for historical, missing, duplicate, or extra edges", () => {
    const { decision, evidenceId, factId } = fixture();
    const base = {
      evidenceDependencies: [{ evidenceId }],
      factDependencies: [{ factId }],
    };
    expect(
      decisionDependencyGraphIsComplete(decision, {
        ...base,
        dependencyGraphComplete: false,
      }),
    ).toBe(false);
    expect(
      decisionDependencyGraphIsComplete(decision, {
        dependencyGraphComplete: true,
        evidenceDependencies: [],
        factDependencies: [{ factId }],
      }),
    ).toBe(false);
    expect(
      decisionDependencyGraphIsComplete(decision, {
        dependencyGraphComplete: true,
        evidenceDependencies: [{ evidenceId }, { evidenceId }],
        factDependencies: [{ factId }],
      }),
    ).toBe(false);
    expect(
      decisionDependencyGraphIsComplete(decision, {
        ...base,
        dependencyGraphComplete: true,
        factDependencies: [{ factId }, { factId: randomUUID() }],
      }),
    ).toBe(false);
  });
});
