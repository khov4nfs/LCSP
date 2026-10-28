import {
  COMPLIANCE_RULE_SET_FAILURE_CODES as Gaps,
  LEGAL_CONTEXT_RELATION_KINDS as Relations,
  complianceRuleSetPacketSchema,
  deriveAssessmentApplicabilityGuidance,
} from "@lcsp/contracts/compliance-rule-set";
import {
  fixtureLegalSource,
  validPacket,
  withDerivedAssessmentSemantics,
} from "../../../../test/support/compliance-rule-set-fixtures.js";
import { validateComplianceRuleSetPacket } from "./compliance-rule-set-integrity.validator.js";

function delegationPacket() {
  const packet = validPacket();
  const [owner, performer] = packet.legalRequirements;
  owner.proposition =
    "Organization A owes the records-delivery duty and remains responsible when another organization performs it.";
  owner.operativePropositions![0].actor =
    "Organization A, the obligation holder";
  owner.operativePropositions![0].action =
    "Deliver records to the requesting customer, including when fulfillment is delegated to Organization B";
  owner.applicabilityConditions = [
    "Organization A delegates records-delivery fulfillment to Organization B for a requesting customer",
  ];
  performer.proposition =
    "Organization B performs delegated fulfillment on behalf of Organization A; A's obligation is not transferred.";
  performer.operativePropositions![0].actor =
    "Organization B, the fulfillment delegate";
  performer.operativePropositions![0].action =
    "Perform records delivery delegated by Organization A for the requesting customer";
  performer.applicabilityConditions = [...owner.applicabilityConditions];
  packet.contextRelations.push({
    relationId: "REL-PERFORMANCE",
    kind: Relations.CROSS_REFERENCE,
    fromLegalRequirementId: performer.legalRequirementId,
    toLegalRequirementId: owner.legalRequirementId,
    toSourceRef: null,
  });
  for (const rule of packet.assessmentRules) {
    rule.applicabilityGuidance = deriveAssessmentApplicabilityGuidance(
      packet.legalRequirements.filter((parent) =>
        rule.legalRequirementIds.includes(parent.legalRequirementId),
      ),
    );
    for (const criterion of rule.criteria)
      criterion.statement = rule.applicabilityGuidance;
  }
  return withDerivedAssessmentSemantics(packet);
}
const failures = (packet: ReturnType<typeof validPacket>) =>
  validateComplianceRuleSetPacket(packet, fixtureLegalSource(), () => false)
    .failures;
const omitGuidance = (packet: ReturnType<typeof validPacket>) => ({
  ...packet,
  assessmentRules: packet.assessmentRules.map(
    ({ applicabilityGuidance, legalIntent, contextRelationIds, ...rule }) => {
      void applicabilityGuidance;
      void legalIntent;
      void contextRelationIds;
      return {
        ...rule,
        criteria: rule.criteria.map(({ statement, ...criterion }) => {
          void statement;
          return criterion;
        }),
      };
    },
  ),
});

describe("parent-bound Assessment Rule applicability", () => {
  it("derives a direct actor duty without inventing delegation", () => {
    const packet = validPacket();
    const parsed = complianceRuleSetPacketSchema.parse(omitGuidance(packet));
    expect(parsed).toEqual(packet);
    expect(failures(parsed)).toEqual([]);
  });
  it("preserves duty holder, fulfillment actor, direction and condition ownership", () => {
    const packet = delegationPacket();
    const parsed = complianceRuleSetPacketSchema.parse(omitGuidance(packet));
    expect(parsed).toEqual(packet);
    expect(failures(parsed)).toEqual([]);
    expect(parsed.assessmentRules[0].applicabilityGuidance).toContain(
      packet.legalRequirements[0].applicabilityConditions[0],
    );
    expect(parsed.assessmentRules[1].applicabilityGuidance).toContain(
      "Organization B, the fulfillment delegate",
    );
    expect(parsed.assessmentRules[1].applicabilityGuidance).toContain(
      "A's obligation is not transferred",
    );
  });
  it("rejects the previous direction inversion rather than silently repairing supplied prose", () => {
    const packet = delegationPacket();
    packet.assessmentRules[1].applicabilityGuidance =
      "Organization B delegates records-delivery fulfillment to Organization A";
    const parsed = complianceRuleSetPacketSchema.parse(packet);
    expect(parsed.assessmentRules[1].applicabilityGuidance).toBe(
      packet.assessmentRules[1].applicabilityGuidance,
    );
    expect(failures(parsed)).toContainEqual(
      expect.objectContaining({
        code: Gaps.APPLICABILITY_BINDING_MISMATCH,
        ref: "assessmentRule:ER-RET",
      }),
    );
  });
  it("rejects guidance rebound to a different parent actor", () => {
    const packet = delegationPacket();
    packet.assessmentRules[0].legalRequirementIds.push("LR-RET");
    expect(
      failures(packet).some(
        (gap) => gap.code === Gaps.APPLICABILITY_BINDING_MISMATCH,
      ),
    ).toBe(true);
  });
  it("keeps multiple actors distinct under legitimate aggregation and stable ID ordering", () => {
    const packet = delegationPacket();
    const [a, b] = packet.legalRequirements;
    expect(deriveAssessmentApplicabilityGuidance([a, b])).toBe(
      deriveAssessmentApplicabilityGuidance([b, a]),
    );
    const text = deriveAssessmentApplicabilityGuidance([a, b]);
    expect(text).toContain(a.operativePropositions![0].actor);
    expect(text).toContain(b.operativePropositions![0].actor);
  });
  it("round trips relation source and target and canonical guidance unchanged", () => {
    const packet = delegationPacket();
    const roundTrip = complianceRuleSetPacketSchema.parse(
      JSON.parse(JSON.stringify(packet)),
    );
    expect(roundTrip).toEqual(packet);
    expect(roundTrip.contextRelations.at(-1)).toMatchObject({
      fromLegalRequirementId: "LR-RET",
      toLegalRequirementId: "LR-DEF",
    });
    expect(failures(roundTrip)).toEqual([]);
  });
  it("rejects stale guidance after a parent condition changes", () => {
    const packet = delegationPacket();
    packet.legalRequirements[1].applicabilityConditions.push(
      "Organization A must first authorize Organization B's performance",
    );
    expect(
      failures(packet).some(
        (gap) => gap.code === Gaps.APPLICABILITY_BINDING_MISMATCH,
      ),
    ).toBe(true);
    expect(failures(withDerivedAssessmentSemantics(packet))).toEqual([]);
  });
  it("retains all parent qualifiers and exception limits", () => {
    const packet = delegationPacket();
    packet.legalRequirements[0].qualifiers = ["Within seven calendar days"];
    packet.legalRequirements[0].exceptions = [
      "Only while a documented specific threat exists; no transfer of the obligation",
    ];
    const parsed = withDerivedAssessmentSemantics(packet);
    expect(parsed.assessmentRules[0].applicabilityGuidance).toContain(
      packet.legalRequirements[0].exceptions[0],
    );
    expect(failures(parsed)).toEqual([]);
  });
  it("does not truncate legitimate aggregated parent bindings at the old prose limit", () => {
    const packet = delegationPacket();
    packet.legalRequirements[0].operativePropositions![0].action = "x".repeat(
      7900,
    );
    const parsed = complianceRuleSetPacketSchema.parse(omitGuidance(packet));
    expect(
      parsed.assessmentRules[0].applicabilityGuidance.length,
    ).toBeGreaterThan(8000);
    expect(complianceRuleSetPacketSchema.parse(parsed)).toEqual(parsed);
  });
});
