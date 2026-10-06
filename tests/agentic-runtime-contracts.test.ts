import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
  answerHumanResolutionRequestSchema,
  humanResolutionRequestSchema,
  openHumanResolutionRequestSchema,
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
  RULE_DECISION_CRITERION_OUTCOMES,
  RULE_DECISION_REFERENCE_TYPES,
  ruleDecisionSchema,
  HUMAN_RESOLUTION_REQUEST_STATUSES,
} from "@lcsp/contracts/assessment";

const ASSESSMENT_ID = "11111111-1111-4111-8111-111111111111";
const THREAD_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const FACT_ID = "44444444-4444-4444-8444-444444444444";
const EVIDENCE_ID = "55555555-5555-4555-8555-555555555555";
const PORTFOLIO_ID = "66666666-6666-4666-8666-666666666666";
const SNAPSHOT_ID = "77777777-7777-4777-8777-777777777777";
const TIMESTAMP = "2026-10-05T10:00:00.000Z";
const CASE_REVISION = 12;

const questionPacket = {
  engineeringRuleId: "ER-privacy-retention",
  criterionIds: ["CR-data-retention"],
  question: "How long does your team retain these records?",
  unresolvedFact: "The retention period is controlled by the customer.",
  decisionImpact: [
    "The period determines whether the retention criterion is met.",
  ],
  resolutionAttempts: [
    "Inspected the pinned repository and available documents.",
  ],
  controlType: "SINGLE_CHOICE",
  choices: [
    { value: "30-days", label: "30 days" },
    { value: "90-days", label: "90 days" },
  ],
};

const openRequest = {
  ...questionPacket,
  requestId: REQUEST_ID,
  assessmentId: ASSESSMENT_ID,
  threadId: THREAD_ID,
  caseRevision: CASE_REVISION,
  status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
  answers: [],
  createdAt: TIMESTAMP,
};

const confirmedFactRef = {
  type: RULE_DECISION_REFERENCE_TYPES.CONFIRMED_FACT,
  factId: FACT_ID,
  caseRevision: CASE_REVISION,
};

test("HumanResolutionRequest requires the complete frozen open packet", () => {
  assert.equal(
    openHumanResolutionRequestSchema.safeParse({
      ...questionPacket,
      expectedCaseRevision: CASE_REVISION,
    }).success,
    true,
  );

  const { unresolvedFact: _unresolvedFact, ...incompletePacket } =
    questionPacket;
  assert.equal(
    openHumanResolutionRequestSchema.safeParse({
      ...incompletePacket,
      expectedCaseRevision: CASE_REVISION,
    }).success,
    false,
  );
  assert.equal(
    humanResolutionRequestSchema.safeParse(openRequest).success,
    true,
  );
});

test("only a confirmed fact tied to the request revision resolves a request", () => {
  const resolvedRequest = {
    ...openRequest,
    status: HUMAN_RESOLUTION_REQUEST_STATUSES.RESOLVED,
    answers: [
      {
        doesNotKnow: false,
        answer: "Records are retained for 30 days.",
        answeredAt: TIMESTAMP,
      },
    ],
    resolvedFactRef: confirmedFactRef,
    resolvedAt: TIMESTAMP,
  };

  assert.equal(
    humanResolutionRequestSchema.safeParse(resolvedRequest).success,
    true,
  );
  assert.equal(
    humanResolutionRequestSchema.safeParse({
      ...resolvedRequest,
      resolvedFactRef: {
        type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
        evidenceId: EVIDENCE_ID,
      },
    }).success,
    false,
  );
  assert.equal(
    humanResolutionRequestSchema.safeParse({
      ...resolvedRequest,
      resolvedFactRef: { ...confirmedFactRef, caseRevision: CASE_REVISION + 1 },
    }).success,
    false,
  );
});

test("an I do not know answer keeps the request open and carries no approval", () => {
  const answer = {
    expectedCaseRevision: CASE_REVISION,
    doesNotKnow: true,
  };
  const answeredOpenRequest = {
    ...openRequest,
    answers: [{ doesNotKnow: true, answeredAt: TIMESTAMP }],
  };

  assert.equal(
    answerHumanResolutionRequestSchema.safeParse(answer).success,
    true,
  );
  assert.equal(
    humanResolutionRequestSchema.safeParse(answeredOpenRequest).success,
    true,
  );
  assert.equal(
    answerHumanResolutionRequestSchema.safeParse({ ...answer, approved: true })
      .success,
    false,
  );
  assert.equal(
    humanResolutionRequestSchema.safeParse({
      ...answeredOpenRequest,
      status: HUMAN_RESOLUTION_REQUEST_STATUSES.RESOLVED,
      resolvedFactRef: confirmedFactRef,
      resolvedAt: TIMESTAMP,
    }).success,
    false,
  );
});

test("unknown-answer history survives supersession and cancellation", () => {
  for (const status of [
    HUMAN_RESOLUTION_REQUEST_STATUSES.SUPERSEDED,
    HUMAN_RESOLUTION_REQUEST_STATUSES.CANCELLED,
  ]) {
    const request = {
      ...openRequest,
      status,
      answers: [{ doesNotKnow: true, answeredAt: TIMESTAMP }],
    };

    assert.deepEqual(humanResolutionRequestSchema.parse(request), request);
  }
});

test("RuleDecision requires typed legal-context references", () => {
  const evidenceRef = {
    type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
    evidenceId: EVIDENCE_ID,
  };
  const decision = {
    engineeringRuleId: "ER-privacy-retention",
    engineeringRuleVersion: "v1",
    scopeId: "tenant-data",
    legalPortfolioVersionId: PORTFOLIO_ID,
    repositorySnapshotId: SNAPSHOT_ID,
    repositoryCommit: "a".repeat(40),
    caseRevision: CASE_REVISION,
    legalContextRefs: [{ legalContextId: "CTX-retention-period" }],
    applicability: RULE_DECISION_APPLICABILITIES.APPLICABLE,
    rationale: "The rule applies to the in-scope records.",
    references: [evidenceRef],
    criteria: [
      {
        criterionId: "CR-data-retention",
        outcome: RULE_DECISION_CRITERION_OUTCOMES.MET,
        rationale: "The configured retention period is within the rule limit.",
        references: [evidenceRef],
      },
    ],
    compliance: RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT,
  };

  assert.equal(ruleDecisionSchema.safeParse(decision).success, true);
  assert.equal(
    ruleDecisionSchema.safeParse({ ...decision, legalContextRefs: [] }).success,
    false,
  );
  assert.equal(
    ruleDecisionSchema.safeParse({
      ...decision,
      legalContextRefs: [
        { legalContextId: "CTX-retention-period", evidenceId: EVIDENCE_ID },
      ],
    }).success,
    false,
  );
});
