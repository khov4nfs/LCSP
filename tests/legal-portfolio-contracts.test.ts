import * as assert from "node:assert/strict";
import { test } from "node:test";

import { ARTIFACT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import {
  LEGAL_CONTEXT_RELATION_KINDS,
  LEGAL_PORTFOLIO_COVERAGE_STATES,
  LEGAL_PORTFOLIO_ERROR_CODES,
  LEGAL_PORTFOLIO_EVENT_TYPES,
  LEGAL_PORTFOLIO_FAILURE_CODES,
  LEGAL_PORTFOLIO_LIMITS,
  legalPortfolioPacketSchema,
  legalPortfolioReadModelSchema,
  legalPortfolioSubmitRequestSchema,
  legalPortfolioSubmitResultSchema,
  legalPreparationStartRequestSchema,
} from "@lcsp/contracts/legal-portfolio";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const UUID = "11111111-1111-4111-8111-111111111111";

const sourceRef = (locator: string, contentSha256 = HASH_A) => ({
  documentId: "doc-1",
  locator,
  contentSha256,
});

function validPacket() {
  return {
    legalRules: [
      {
        legalRuleId: "LR-1",
        title: "Retention",
        proposition: "Records must be retained.",
        applicabilityConditions: ["The system stores records."],
        qualifiers: ["Only for regulated records."],
        exceptions: ["Unless the record is anonymised."],
        nonRepositoryDuty: false,
        sourceRefs: [sourceRef("art-5::cl-1")],
        coverage: {
          state: LEGAL_PORTFOLIO_COVERAGE_STATES.COVERED_BY_ENGINEERING_RULES,
          nonAssessableReason: null,
        },
      },
      {
        legalRuleId: "LR-2",
        title: "In-person duty",
        proposition: "A person must attend in person.",
        applicabilityConditions: [],
        qualifiers: [],
        exceptions: [],
        nonRepositoryDuty: true,
        sourceRefs: [sourceRef("art-6::cl-1")],
        coverage: {
          state: LEGAL_PORTFOLIO_COVERAGE_STATES.NON_ASSESSABLE,
          nonAssessableReason: "Cannot be established from a repository.",
        },
      },
    ],
    engineeringRules: [
      {
        engineeringRuleId: "ER-1",
        legalRuleIds: ["LR-1"],
        concept: "Retention policy",
        legalIntent: "Ensure records are retained.",
        applicabilityGuidance: "Applies when records are stored.",
        criteria: [
          { criterionId: "C-1", statement: "A retention period exists." },
        ],
        investigationGoals: ["find retention config"],
        startingNodeTypes: [],
        targetNodeTypes: [],
        edgeStrategies: [],
        graphQueries: [],
        keywords: ["retention"],
        commonApis: [],
        commonLibraries: [],
        patterns: [],
        requiredEvidence: ["retention config"],
        supportingEvidence: [],
        negativeEvidence: [],
        unresolvedConditions: [],
        sourceRefs: [sourceRef("art-5::cl-1")],
      },
    ],
    contextRelations: [
      {
        relationId: "REL-1",
        kind: LEGAL_CONTEXT_RELATION_KINDS.EXCEPTION,
        fromLegalRuleId: "LR-1",
        toLegalRuleId: null,
        toSourceRef: sourceRef("art-3::cl-1", HASH_B),
      },
    ],
  };
}

test("a complete packet parses and every value set is canonical", () => {
  assert.equal(
    legalPortfolioPacketSchema.safeParse(validPacket()).success,
    true,
  );
  for (const set of [
    LEGAL_PORTFOLIO_COVERAGE_STATES,
    LEGAL_CONTEXT_RELATION_KINDS,
    LEGAL_PORTFOLIO_FAILURE_CODES,
  ]) {
    for (const [key, value] of Object.entries(set)) {
      assert.equal(key, value);
      assert.match(value, /^[A-Z][A-Z0-9_]*$/);
    }
  }
});

test("the packet is strict: agent-supplied authority fields are rejected", () => {
  for (const extra of [
    { status: "APPROVED" },
    { authoredBy: "reviewer" },
    { legalCorpusVersionId: UUID },
    { humanLegalSignoffRequired: true },
  ]) {
    const packet = validPacket();
    Object.assign(packet.legalRules[0]!, extra);
    assert.equal(legalPortfolioPacketSchema.safeParse(packet).success, false);
  }
  const packet = validPacket();
  Object.assign(packet, { portfolioVersionId: UUID });
  assert.equal(legalPortfolioPacketSchema.safeParse(packet).success, false);
});

test("source claims need a well-formed hash and relations need exactly one target", () => {
  const badHash = validPacket();
  badHash.legalRules[0]!.sourceRefs[0]!.contentSha256 = "not-a-hash";
  assert.equal(legalPortfolioPacketSchema.safeParse(badHash).success, false);
  // the bare hex form is not the corpus representation and is rejected
  badHash.legalRules[0]!.sourceRefs[0]!.contentSha256 = "a".repeat(64);
  assert.equal(legalPortfolioPacketSchema.safeParse(badHash).success, false);

  const both = validPacket();
  Object.assign(both.contextRelations[0]!, { toLegalRuleId: "LR-2" });
  assert.equal(legalPortfolioPacketSchema.safeParse(both).success, false);

  const neither = validPacket();
  Object.assign(neither.contextRelations[0]!, { toSourceRef: null });
  assert.equal(legalPortfolioPacketSchema.safeParse(neither).success, false);

  const noSources = validPacket();
  noSources.legalRules[0]!.sourceRefs = [];
  assert.equal(legalPortfolioPacketSchema.safeParse(noSources).success, false);
});

test("oversize packets are rejected at the trust boundary", () => {
  const packet = validPacket();
  packet.legalRules[0]!.proposition = "x".repeat(
    LEGAL_PORTFOLIO_LIMITS.maxTextLength + 1,
  );
  assert.equal(legalPortfolioPacketSchema.safeParse(packet).success, false);
});

test("submit request and result reuse the shared artifact lifecycle only", () => {
  const request = {
    preparationRunId: UUID,
    idempotencyKey: "idem-key-0001",
    packet: validPacket(),
  };
  assert.equal(
    legalPortfolioSubmitRequestSchema.safeParse(request).success,
    true,
  );
  assert.equal(
    legalPortfolioSubmitRequestSchema.safeParse({
      ...request,
      legalCorpusVersionId: UUID,
    }).success,
    false,
  );
  assert.equal(
    legalPreparationStartRequestSchema.safeParse({
      legalCorpusVersionId: UUID,
      idempotencyKey: "idem-key-0001",
    }).success,
    true,
  );

  const result = {
    preparationRunId: UUID,
    portfolioVersionId: UUID,
    version: "portfolio-1",
    lifecycleState: ARTIFACT_LIFECYCLE_STATES.ACTIVE,
    validation: { outcome: "PASSED", failures: [] },
    activationRecordId: UUID,
    previousActivePortfolioVersionId: null,
    replayed: false,
  };
  assert.equal(
    legalPortfolioSubmitResultSchema.safeParse(result).success,
    true,
  );
  for (const lifecycleState of ["APPROVED", "REJECTED", "DRAFT", "ACTIVATED"]) {
    assert.equal(
      legalPortfolioSubmitResultSchema.safeParse({ ...result, lifecycleState })
        .success,
      false,
    );
  }
});

test("no approval vocabulary exists in the portfolio contract", () => {
  const vocabulary = JSON.stringify([
    LEGAL_PORTFOLIO_FAILURE_CODES,
    LEGAL_PORTFOLIO_ERROR_CODES,
    LEGAL_PORTFOLIO_EVENT_TYPES,
  ]).toLowerCase();
  for (const forbidden of [
    "approv",
    "signoff",
    "reject",
    "publish",
    "discard",
  ]) {
    assert.equal(vocabulary.includes(forbidden), false, forbidden);
  }
  assert.equal(legalPortfolioReadModelSchema.safeParse({}).success, false);
});
