import {
  COMPLIANCE_RULE_SET_FAILURE_CODES as Gaps,
  LEGAL_OPERATIVE_MODALITIES as Modality,
  complianceRuleSetPacketSchema,
  assessmentRuleSchema,
  deriveAssessmentApplicabilityGuidance,
} from "@lcsp/contracts/compliance-rule-set";
import {
  fixtureLegalSource,
  validPacket,
} from "../../../../test/support/compliance-rule-set-fixtures.js";
import { validateComplianceRuleSetPacket } from "./compliance-rule-set-integrity.validator.js";

function candidate() {
  const packet = validPacket();
  const parent = packet.legalRequirements[0];
  parent.proposition =
    "A must not impose charges intended to prevent transfer.";
  parent.operativePropositions![0].modality = Modality.PROHIBITION;
  parent.operativePropositions![0].action =
    "impose charges intended to prevent transfer";
  parent.qualifiers = [
    "Only after the transitional period",
    "Only for the defined class of records",
  ];
  parent.exceptions = [
    "A documented specific security threat permits a proportionate temporary block until the threat ends",
  ];
  const input = {
    ...packet,
    assessmentRules: packet.assessmentRules.map(
      ({ applicabilityGuidance, ...rule }) => {
        void applicabilityGuidance;
        return {
          ...rule,
          criteria: rule.criteria.map(({ statement, ...criterion }) => {
            void statement;
            return criterion;
          }),
        };
      },
    ),
  };
  return complianceRuleSetPacketSchema.parse(input);
}
const failures = (packet: ReturnType<typeof candidate>) =>
  validateComplianceRuleSetPacket(packet, fixtureLegalSource(), () => false)
    .failures;

describe("parent-bound criterion predicate fidelity", () => {
  it("retains a purpose-qualified prohibition, multiple qualifiers and the limiting exception", () => {
    const packet = candidate();
    expect(failures(packet)).toEqual([]);
    expect(packet.assessmentRules[0].criteria[0].statement).toBe(
      deriveAssessmentApplicabilityGuidance([packet.legalRequirements[0]]),
    );
  });
  it("rejects the exact broadening class even when applicability guidance is correct", () => {
    const packet = candidate();
    packet.assessmentRules[0].criteria[0].statement =
      "A must not impose any charges for transfer.";
    const parsed = complianceRuleSetPacketSchema.parse(packet);
    expect(parsed.assessmentRules[0].criteria[0].statement).toBe(
      packet.assessmentRules[0].criteria[0].statement,
    );
    expect(failures(parsed)).toContainEqual(
      expect.objectContaining({
        code: Gaps.APPLICABILITY_BINDING_MISMATCH,
        ref: "assessmentRule:ER-DEF|criterion:C-1",
      }),
    );
  });
  it("permits narrower technical evidence focus without replacing the legal predicate", () => {
    const packet = candidate();
    const rule = packet.assessmentRules[0];
    rule.criteria[0].investigationFocus =
      "Examine the customer-facing billing endpoint in this repository";
    rule.criteria.push({
      ...rule.criteria[0],
      criterionId: "C-STORAGE",
      investigationFocus: "Examine the export queue storage surface",
    });
    expect(failures(packet)).toEqual([]);
    expect(rule.criteria[0].statement).toBe(rule.criteria[1].statement);
  });
  it("keeps conditional duties and exception ownership bound to the parent", () => {
    const packet = candidate();
    const parent = packet.legalRequirements[0];
    parent.operativePropositions![0].modality = Modality.DUTY;
    parent.applicabilityConditions = [
      "When A delegates fulfillment to B and the customer requests delivery",
    ];
    const expected = deriveAssessmentApplicabilityGuidance([parent]);
    packet.assessmentRules[0].applicabilityGuidance = expected;
    packet.assessmentRules[0].criteria[0].statement = expected;
    expect(failures(packet)).toEqual([]);
    packet.assessmentRules[0].criteria[0].statement =
      "B delegates fulfillment to A";
    expect(failures(packet)).toContainEqual(
      expect.objectContaining({ code: Gaps.APPLICABILITY_BINDING_MISMATCH }),
    );
  });
  it.each([undefined, [], ["LR-MISSING"], ["LR-PERSON"], ["LR-DEF", "LR-DEF"]])(
    "rejects absent, foreign or duplicate criterion parents: %j",
    (ids) => {
      const packet = candidate();
      packet.assessmentRules[0].criteria[0].legalRequirementIds = ids;
      expect(failures(packet)).toContainEqual(
        expect.objectContaining({ code: Gaps.APPLICABILITY_BINDING_MISMATCH }),
      );
    },
  );
  it("requires every claimed parent to be represented while allowing semantic aggregation", () => {
    const packet = candidate();
    const rule = packet.assessmentRules[1];
    rule.criteria[0].legalRequirementIds = [rule.legalRequirementIds[0]];
    rule.criteria[0].statement = deriveAssessmentApplicabilityGuidance([
      packet.legalRequirements[1],
    ]);
    expect(failures(packet)).toContainEqual(
      expect.objectContaining({
        code: Gaps.APPLICABILITY_BINDING_MISMATCH,
        ref: "assessmentRule:ER-RET",
      }),
    );
    rule.criteria.push({
      criterionId: "C-EXCEPTION",
      legalRequirementIds: ["LR-EXC"],
      statement: deriveAssessmentApplicabilityGuidance([
        packet.legalRequirements[2],
      ]),
    });
    expect(failures(packet)).toEqual([]);
  });
  it("does not introduce a qualifier for a direct unqualified prohibition", () => {
    const packet = candidate();
    const parent = packet.legalRequirements[0];
    parent.proposition = "A must not disclose records.";
    parent.operativePropositions![0].action = "disclose records";
    parent.qualifiers = [];
    parent.exceptions = [];
    const expected = deriveAssessmentApplicabilityGuidance([parent]);
    packet.assessmentRules[0].applicabilityGuidance = expected;
    packet.assessmentRules[0].criteria[0].statement = expected;
    expect(failures(packet)).toEqual([]);
    expect(expected).not.toContain("Qualifier");
  });
  it("round trips binding identity and focus; historical criterion reads remain unchanged", () => {
    const packet = candidate();
    packet.assessmentRules[0].criteria[0].investigationFocus =
      "Repository storage only";
    expect(
      complianceRuleSetPacketSchema.parse(JSON.parse(JSON.stringify(packet))),
    ).toEqual(packet);
    const historical = validPacket().assessmentRules[0];
    historical.criteria = [
      { criterionId: "HISTORICAL", statement: "Original accepted wording" },
    ];
    expect(assessmentRuleSchema.parse(historical)).toEqual(historical);
  });
});
