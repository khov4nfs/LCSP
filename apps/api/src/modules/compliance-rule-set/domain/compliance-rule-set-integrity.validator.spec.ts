import { COMPLIANCE_RULE_SET_FAILURE_CODES } from "@lcsp/contracts/compliance-rule-set";
import { complianceRuleSetPacketSchema } from "@lcsp/contracts/compliance-rule-set";

import {
  FIXTURE_LEAVES,
  fixtureChunks,
  fixtureLegalSource,
  fixtureHash,
  ref,
  validPacket,
} from "../../../../test/support/compliance-rule-set-fixtures.js";
import {
  canonicalJson,
  sourceClaimKey,
  validateComplianceRuleSetPacket,
} from "./compliance-rule-set-integrity.validator.js";

const never = () => false;
const codes = (failures: Array<{ code: string }>) =>
  failures.map((f) => f.code);

describe("validateComplianceRuleSetPacket (mechanical integrity only)", () => {
  it("accepts a complete packet whose source claims all resolve", () => {
    const packet = validPacket();
    expect(complianceRuleSetPacketSchema.safeParse(packet).success).toBe(true);
    const { failures, resolved } = validateComplianceRuleSetPacket(
      packet,
      fixtureLegalSource(),
      never,
    );
    expect(failures).toEqual([]);
    for (const leaf of FIXTURE_LEAVES) {
      expect(
        resolved.has(
          sourceClaimKey({
            documentId: "SYNTHETIC-NOTICE-INSTRUMENT",
            locator: leaf,
          }),
        ),
      ).toBe(true);
    }
  });

  it("rejects a fake reference (locator not in the pinned legalSource)", () => {
    const packet = validPacket();
    packet.legalRequirements[0].sourceRefs.push({
      ...ref("art-1::cl-1"),
      locator: "art-99::cl-1",
    });
    const { failures } = validateComplianceRuleSetPacket(
      packet,
      fixtureLegalSource(),
      never,
    );
    expect(codes(failures)).toContain(
      COMPLIANCE_RULE_SET_FAILURE_CODES.UNRESOLVED_SOURCE_REFERENCE,
    );
  });

  it("rejects a stale hash (declared hash is from another legalSource version)", () => {
    const packet = validPacket();
    packet.legalRequirements[1].sourceRefs[0] = ref("art-5::cl-1::pt-a");
    packet.legalRequirements[1].sourceRefs.push(ref("art-5::cl-1", "v2")); // art-5::cl-1 changed in v2
    const { failures } = validateComplianceRuleSetPacket(
      packet,
      fixtureLegalSource(),
      never,
    );
    expect(codes(failures)).toContain(
      COMPLIANCE_RULE_SET_FAILURE_CODES.STALE_SOURCE_HASH,
    );
    expect(codes(failures)).not.toContain(
      COMPLIANCE_RULE_SET_FAILURE_CODES.MIXED_SOURCE_VERSION,
    );
  });

  it("reports mixed legalSource versions when clean claims and foreign-version claims coexist", () => {
    const packet = validPacket();
    packet.legalRequirements[1].sourceRefs.push(ref("art-5::cl-1", "v2"));
    const foreign = (claim: { locator: string; contentSha256: string }) =>
      claim.contentSha256 === fixtureHash("art-5::cl-1", "v2");
    const { failures } = validateComplianceRuleSetPacket(
      packet,
      fixtureLegalSource(),
      foreign,
    );
    expect(codes(failures)).toEqual(
      expect.arrayContaining([
        COMPLIANCE_RULE_SET_FAILURE_CODES.STALE_SOURCE_HASH,
        COMPLIANCE_RULE_SET_FAILURE_CODES.MIXED_SOURCE_VERSION,
      ]),
    );
  });

  it("rejects a repealed source reference", () => {
    const legalSource = fixtureLegalSource(
      {},
      { "art-2::cl-1": { legalEffectStatus: "REPEALED" } },
    );
    const { failures } = validateComplianceRuleSetPacket(
      validPacket(),
      legalSource,
      never,
    );
    expect(codes(failures)).toContain(
      COMPLIANCE_RULE_SET_FAILURE_CODES.REPEALED_SOURCE_REFERENCE,
    );
  });

  it("does not require a provision explicitly marked repealed as a current obligation", () => {
    const packet = validPacket();
    packet.legalRequirements.forEach((rule) => {
      rule.sourceRefs = rule.sourceRefs.filter(
        (source) => source.locator !== "art-2::cl-1",
      );
    });
    packet.assessmentRules.forEach((rule) => {
      rule.sourceRefs = rule.sourceRefs.filter(
        (source) => source.locator !== "art-2::cl-1",
      );
    });
    packet.contextRelations = packet.contextRelations.filter(
      (relation) => relation.toSourceRef?.locator !== "art-2::cl-1",
    );
    const { failures } = validateComplianceRuleSetPacket(
      packet,
      fixtureLegalSource(
        {},
        { "art-2::cl-1": { legalEffectStatus: "REPEALED" } },
      ),
      never,
    );
    expect(codes(failures)).not.toContain(
      COMPLIANCE_RULE_SET_FAILURE_CODES.INCOMPLETE_SOURCE_COVERAGE,
    );
    expect(codes(failures)).not.toContain(
      COMPLIANCE_RULE_SET_FAILURE_CODES.REPEALED_SOURCE_REFERENCE,
    );
  });

  it("keeps unknown source effect explicitly undetermined", () => {
    const source = fixtureLegalSource(
      {},
      {
        "art-2::cl-1": {
          legalEffectStatus: "UNKNOWN",
          legalStatusSourceRef: null,
        },
      },
    );
    const chunk = source.chunks.find((item) => item.locator === "art-2::cl-1");
    expect(chunk).toMatchObject({
      legalEffectStatus: "UNKNOWN",
      legalStatusSourceRef: null,
    });
    const { failures } = validateComplianceRuleSetPacket(
      validPacket(),
      source,
      never,
    );
    expect(codes(failures)).toContain(
      COMPLIANCE_RULE_SET_FAILURE_CODES.UNDETERMINED_SOURCE_STATUS,
    );
  });

  it("does not accept a future-effective provision as a current source", () => {
    const { failures } = validateComplianceRuleSetPacket(
      validPacket(),
      fixtureLegalSource(
        {},
        {
          "art-1::cl-1": {
            legalEffectStatus: "FUTURE",
            legalStatusSourceRef: "metadata:future",
          },
        },
      ),
      never,
    );
    expect(codes(failures)).toContain(
      COMPLIANCE_RULE_SET_FAILURE_CODES.NON_CURRENT_SOURCE_REFERENCE,
    );
  });

  it("rejects duplicate rule, assessment rule and relation ids", () => {
    const packet = validPacket();
    packet.legalRequirements.push({ ...packet.legalRequirements[0] });
    packet.assessmentRules.push({ ...packet.assessmentRules[0] });
    packet.contextRelations.push({ ...packet.contextRelations[0] });
    const { failures } = validateComplianceRuleSetPacket(
      packet,
      fixtureLegalSource(),
      never,
    );
    expect(codes(failures)).toEqual(
      expect.arrayContaining([
        COMPLIANCE_RULE_SET_FAILURE_CODES.DUPLICATE_RULE_ID,
        COMPLIANCE_RULE_SET_FAILURE_CODES.DUPLICATE_ASSESSMENT_RULE_ID,
      ]),
    );
  });

  it("rejects orphan assessment rules and orphan context relations", () => {
    const packet = validPacket();
    packet.assessmentRules[0].legalRequirementIds = ["LR-MISSING"];
    packet.contextRelations[0].toLegalRequirementId = "LR-MISSING-TARGET";
    const { failures } = validateComplianceRuleSetPacket(
      packet,
      fixtureLegalSource(),
      never,
    );
    expect(codes(failures)).toEqual(
      expect.arrayContaining([
        COMPLIANCE_RULE_SET_FAILURE_CODES.ORPHAN_ASSESSMENT_RULE,
        COMPLIANCE_RULE_SET_FAILURE_CODES.ORPHAN_CONTEXT_RELATION,
      ]),
    );
  });

  it("rejects a provision that is neither covered nor declared non-assessable", () => {
    const packet = validPacket();
    packet.legalRequirements = packet.legalRequirements.filter(
      (rule) => rule.legalRequirementId !== "LR-PERSON",
    );
    const { failures } = validateComplianceRuleSetPacket(
      packet,
      fixtureLegalSource(),
      never,
    );
    const coverage = failures.filter(
      (failure) =>
        failure.code ===
        COMPLIANCE_RULE_SET_FAILURE_CODES.INCOMPLETE_SOURCE_COVERAGE,
    );
    expect(coverage.map((failure) => failure.ref)).toEqual([
      "locator:SYNTHETIC-NOTICE-INSTRUMENT::art-6::cl-1",
    ]);
  });

  it("counts a cited ancestor as covering its descendants", () => {
    const packet = validPacket();
    packet.legalRequirements[1].sourceRefs = [ref("art-5::cl-1")]; // parent covers pt-a and pt-b
    const { failures } = validateComplianceRuleSetPacket(
      packet,
      fixtureLegalSource(),
      never,
    );
    expect(failures).toEqual([]);
  });

  it("requires every covered rule to have an AssessmentRule and every non-assessable rule a reason", () => {
    const packet = validPacket();
    packet.assessmentRules = packet.assessmentRules.filter(
      (rule) => rule.assessmentRuleId !== "ER-DEF",
    );
    packet.legalRequirements[4].coverage.nonAssessableReason = "   ";
    const { failures } = validateComplianceRuleSetPacket(
      packet,
      fixtureLegalSource(),
      never,
    );
    expect(codes(failures)).toEqual(
      expect.arrayContaining([
        COMPLIANCE_RULE_SET_FAILURE_CODES.INCOMPLETE_RULE_COVERAGE,
        COMPLIANCE_RULE_SET_FAILURE_CODES.NON_ASSESSABLE_REASON_REQUIRED,
      ]),
    );
  });

  it("requires an assessable requirement to declare its applicability scope, in whatever terms the source uses", () => {
    const withoutScope = validPacket();
    const covered = withoutScope.legalRequirements.find(
      (rule) => rule.coverage.state === "COVERED_BY_ASSESSMENT_RULES",
    );
    if (!covered) throw new Error("fixture must contain a covered requirement");
    covered.applicabilityConditions = [];
    const rejected = validateComplianceRuleSetPacket(
      withoutScope,
      fixtureLegalSource(),
      never,
    ).failures.filter(
      (failure) =>
        failure.code ===
        COMPLIANCE_RULE_SET_FAILURE_CODES.APPLICABILITY_SCOPE_MISSING,
    );
    expect(rejected).toEqual([
      expect.objectContaining({
        ref: `legalRequirement:${covered.legalRequirementId}`,
      }),
    ]);

    // Any wording passes: the check never learns which roles, categories or terms a legal source uses.
    for (const scope of [
      "Applies to the keeper of a register.",
      "Gilt für Betreiber von Hochrisikosystemen, sofern sie Daten verarbeiten.",
      "Every holder of a vessel licence",
    ]) {
      covered.applicabilityConditions = [scope];
      expect(
        codes(
          validateComplianceRuleSetPacket(
            withoutScope,
            fixtureLegalSource(),
            never,
          ).failures,
        ),
      ).not.toContain(
        COMPLIANCE_RULE_SET_FAILURE_CODES.APPLICABILITY_SCOPE_MISSING,
      );
    }
  });

  it("does not ask a non-assessable requirement for an applicability scope", () => {
    const packet = validPacket();
    const nonAssessable = packet.legalRequirements.filter(
      (rule) => rule.coverage.state === "NON_ASSESSABLE",
    );
    expect(nonAssessable.length).toBeGreaterThan(0);
    for (const rule of nonAssessable) rule.applicabilityConditions = [];
    expect(
      codes(
        validateComplianceRuleSetPacket(packet, fixtureLegalSource(), never)
          .failures,
      ),
    ).not.toContain(
      COMPLIANCE_RULE_SET_FAILURE_CODES.APPLICABILITY_SCOPE_MISSING,
    );
  });

  it("fails an empty ruleSet and an invalid retrieval index without judging meaning", () => {
    const empty = {
      legalRequirements: [],
      assessmentRules: [],
      contextRelations: [],
    };
    const result = validateComplianceRuleSetPacket(
      empty,
      fixtureLegalSource({ retrievalIndexValid: false }),
      never,
    );
    expect(codes(result.failures)).toEqual(
      expect.arrayContaining([
        COMPLIANCE_RULE_SET_FAILURE_CODES.EMPTY_RULE_SET,
        COMPLIANCE_RULE_SET_FAILURE_CODES.RETRIEVAL_INDEX_NOT_VALID,
      ]),
    );
  });

  it("is deterministic and never mutates the packet or the legalSource", () => {
    const packet = validPacket();
    const legalSource = fixtureLegalSource();
    const before = canonicalJson({ packet, legalSource });
    const first = validateComplianceRuleSetPacket(packet, legalSource, never);
    const second = validateComplianceRuleSetPacket(packet, legalSource, never);
    expect(canonicalJson({ packet, legalSource })).toBe(before);
    expect(first.failures).toEqual(second.failures);
    expect(fixtureChunks().length).toBeGreaterThan(0);
  });

  it("canonicalJson ignores key order so equal packets hash equally", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(
      canonicalJson({ a: [2, { c: 2, d: 1 }], b: 1 }),
    );
  });
});
