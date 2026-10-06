import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  answerHumanResolutionRequestSchema,
  humanResolutionRequestSchema,
  HUMAN_RESOLUTION_REQUEST_STATUSES,
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
  RULE_DECISION_REFERENCE_TYPES,
  ruleDecisionSchema,
} from "@lcsp/contracts/assessment";

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/assessment-root/decision-cases.json", import.meta.url),
    "utf8",
  ),
);

test("authored Assessment Root decision/HITL packets prove structure only", () => {
  const context = fixture.pinnedContext;
  const evidenceIds = new Set(
    context.evidence.map(
      ({ evidenceId }: { evidenceId: string }) => evidenceId,
    ),
  );
  const legalContextIds = new Set(
    context.legal.contexts.map(
      ({ legalContextId }: { legalContextId: string }) => legalContextId,
    ),
  );
  const decisions = fixture.cases.flatMap(
    ({ expected }: { expected: { decisions: unknown[] } }) =>
      expected.decisions,
  );

  assert.deepEqual(
    fixture.cases.map(({ id }: { id: string }) => id),
    [
      "applicable-compliant",
      "applicable-non-compliant",
      "not-applicable",
      "material-human-fact-unknown",
      "shared-evidence-across-two-rules",
    ],
  );
  assert.equal(decisions.length, 5);

  for (const decision of decisions) {
    assert.equal(ruleDecisionSchema.safeParse(decision).success, true);
    assert.equal(
      decision.legalPortfolioVersionId,
      context.legal.legalPortfolioVersionId,
    );
    assert.equal(
      decision.repositorySnapshotId,
      context.repository.repositorySnapshotId,
    );
    assert.equal(
      decision.repositoryCommit,
      context.repository.repositoryCommit,
    );
    assert.equal(decision.caseRevision, context.assessment.caseRevision);
    assert.ok(
      decision.legalContextRefs.every(
        ({ legalContextId }: { legalContextId: string }) =>
          legalContextIds.has(legalContextId),
      ),
    );
    for (const reference of [
      ...decision.references,
      ...decision.criteria.flatMap(
        ({ references }: { references: unknown[] }) => references,
      ),
    ]) {
      if (
        reference.type === RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE
      ) {
        assert.ok(evidenceIds.has(reference.evidenceId));
      }
    }
  }

  const compliantDecision = fixture.cases[0].expected.decisions[0];
  assert.equal(
    compliantDecision.applicability,
    RULE_DECISION_APPLICABILITIES.APPLICABLE,
  );
  assert.equal(
    compliantDecision.compliance,
    RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT,
  );

  const nonCompliantDecision = fixture.cases[1].expected.decisions[0];
  assert.equal(
    nonCompliantDecision.compliance,
    RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT,
  );

  const notApplicableDecision = fixture.cases[2].expected.decisions[0];
  assert.equal(
    notApplicableDecision.applicability,
    RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE,
  );
  assert.deepEqual(notApplicableDecision.criteria, []);
  assert.equal(notApplicableDecision.compliance, null);

  const humanResolution = fixture.cases[3].expected.humanResolution;
  assert.equal(
    humanResolutionRequestSchema.safeParse(humanResolution.openRequest).success,
    true,
  );
  assert.equal(
    answerHumanResolutionRequestSchema.safeParse(humanResolution.answer)
      .success,
    true,
  );
  assert.equal(
    humanResolutionRequestSchema.safeParse(humanResolution.afterUnknownAnswer)
      .success,
    true,
  );
  assert.equal(
    humanResolution.afterUnknownAnswer.status,
    HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
  );
  assert.equal("resolvedFactRef" in humanResolution.afterUnknownAnswer, false);

  const sharedEvidenceId = fixture.cases[4].scenarioInput.sharedEvidenceId;
  for (const decision of fixture.cases[4].expected.decisions) {
    assert.ok(
      decision.references.some(
        (reference: { type: string; evidenceId?: string }) =>
          reference.type ===
            RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE &&
          reference.evidenceId === sharedEvidenceId,
      ),
    );
  }

  assert.equal(
    ruleDecisionSchema.safeParse({
      ...compliantDecision,
      references: [{ type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE }],
    }).success,
    false,
  );
  assert.equal(
    ruleDecisionSchema.safeParse({
      ...compliantDecision,
      references: [
        {
          type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
          evidenceId: "not-a-uuid",
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    ruleDecisionSchema.safeParse({
      ...compliantDecision,
      legalContextRefs: [],
    }).success,
    false,
  );
});
