import * as assert from "node:assert/strict";
import { test } from "node:test";

import { ARTIFACT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import {
  LEGAL_CONTEXT_RELATION_KINDS,
  LEGAL_REQUIREMENT_COVERAGE_STATES,
  COMPLIANCE_RULE_SET_ERROR_CODES,
  COMPLIANCE_RULE_SET_EVENT_TYPES,
  COMPLIANCE_RULE_SET_FAILURE_CODES,
  COMPLIANCE_RULE_SET_LIMITS,
  complianceRuleSetPacketSchema,
  complianceRuleSetReadModelSchema,
  complianceRuleSetSubmitRequestSchema,
  complianceRuleSetSubmitResultSchema,
  ruleSetPreparationStartRequestSchema,
} from "@lcsp/contracts/compliance-rule-set";

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
    legalRequirements: [
      {
        legalRequirementId: "LR-1",
        title: "Retention",
        proposition: "Records must be retained.",
        applicabilityConditions: ["The system stores records."],
        qualifiers: ["Only for regulated records."],
        exceptions: ["Unless the record is anonymised."],
        nonRepositoryDuty: false,
        sourceRefs: [sourceRef("art-5::cl-1")],
        coverage: {
          state: LEGAL_REQUIREMENT_COVERAGE_STATES.COVERED_BY_ASSESSMENT_RULES,
          nonAssessableReason: null,
        },
      },
      {
        legalRequirementId: "LR-2",
        title: "In-person duty",
        proposition: "A person must attend in person.",
        applicabilityConditions: [],
        qualifiers: [],
        exceptions: [],
        nonRepositoryDuty: true,
        sourceRefs: [sourceRef("art-6::cl-1")],
        coverage: {
          state: LEGAL_REQUIREMENT_COVERAGE_STATES.NON_ASSESSABLE,
          nonAssessableReason: "Cannot be established from a repository.",
        },
      },
    ],
    assessmentRules: [
      {
        assessmentRuleId: "ER-1",
        legalRequirementIds: ["LR-1"],
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
        fromLegalRequirementId: "LR-1",
        toLegalRequirementId: null,
        toSourceRef: sourceRef("art-3::cl-1", HASH_B),
      },
    ],
  };
}

test("a complete packet parses and every value set is canonical", () => {
  assert.equal(
    complianceRuleSetPacketSchema.safeParse(validPacket()).success,
    true,
  );
  for (const set of [
    LEGAL_REQUIREMENT_COVERAGE_STATES,
    LEGAL_CONTEXT_RELATION_KINDS,
    COMPLIANCE_RULE_SET_FAILURE_CODES,
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
    { legalSourceVersionId: UUID },
    { humanLegalSignoffRequired: true },
  ]) {
    const packet = validPacket();
    Object.assign(packet.legalRequirements[0]!, extra);
    assert.equal(complianceRuleSetPacketSchema.safeParse(packet).success, false);
  }
  const packet = validPacket();
  Object.assign(packet, { ruleSetVersionId: UUID });
  assert.equal(complianceRuleSetPacketSchema.safeParse(packet).success, false);
});

test("source claims need a well-formed hash and relations need exactly one target", () => {
  const badHash = validPacket();
  badHash.legalRequirements[0]!.sourceRefs[0]!.contentSha256 = "not-a-hash";
  assert.equal(complianceRuleSetPacketSchema.safeParse(badHash).success, false);
  // the bare hex form is not the corpus representation and is rejected
  badHash.legalRequirements[0]!.sourceRefs[0]!.contentSha256 = "a".repeat(64);
  assert.equal(complianceRuleSetPacketSchema.safeParse(badHash).success, false);

  const both = validPacket();
  Object.assign(both.contextRelations[0]!, { toLegalRequirementId: "LR-2" });
  assert.equal(complianceRuleSetPacketSchema.safeParse(both).success, false);

  const neither = validPacket();
  Object.assign(neither.contextRelations[0]!, { toSourceRef: null });
  assert.equal(complianceRuleSetPacketSchema.safeParse(neither).success, false);

  const noSources = validPacket();
  noSources.legalRequirements[0]!.sourceRefs = [];
  assert.equal(complianceRuleSetPacketSchema.safeParse(noSources).success, false);
});

test("oversize packets are rejected at the trust boundary", () => {
  const packet = validPacket();
  packet.legalRequirements[0]!.proposition = "x".repeat(
    COMPLIANCE_RULE_SET_LIMITS.maxTextLength + 1,
  );
  assert.equal(complianceRuleSetPacketSchema.safeParse(packet).success, false);
});

test("submit request and result reuse the shared artifact lifecycle only", () => {
  const request = {
    preparationRunId: UUID,
    idempotencyKey: "idem-key-0001",
    packet: validPacket(),
  };
  assert.equal(
    complianceRuleSetSubmitRequestSchema.safeParse(request).success,
    true,
  );
  assert.equal(
    complianceRuleSetSubmitRequestSchema.safeParse({
      ...request,
      legalSourceVersionId: UUID,
    }).success,
    false,
  );
  assert.equal(
    ruleSetPreparationStartRequestSchema.safeParse({
      legalSourceVersionId: UUID,
      idempotencyKey: "idem-key-0001",
    }).success,
    true,
  );

  const result = {
    preparationRunId: UUID,
    ruleSetVersionId: UUID,
    version: "rule-set-1",
    lifecycleState: ARTIFACT_LIFECYCLE_STATES.ACTIVE,
    validation: { outcome: "PASSED", failures: [] },
    activationRecordId: UUID,
    previousActiveRuleSetVersionId: null,
    replayed: false,
  };
  assert.equal(
    complianceRuleSetSubmitResultSchema.safeParse(result).success,
    true,
  );
  for (const lifecycleState of ["APPROVED", "REJECTED", "DRAFT", "ACTIVATED"]) {
    assert.equal(
      complianceRuleSetSubmitResultSchema.safeParse({ ...result, lifecycleState })
        .success,
      false,
    );
  }
});

test("no approval vocabulary exists in the ruleSet contract", () => {
  const vocabulary = JSON.stringify([
    COMPLIANCE_RULE_SET_FAILURE_CODES,
    COMPLIANCE_RULE_SET_ERROR_CODES,
    COMPLIANCE_RULE_SET_EVENT_TYPES,
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
  assert.equal(complianceRuleSetReadModelSchema.safeParse({}).success, false);
});
