import {
  LEGAL_REQUIREMENT_COVERAGE_STATES,
  complianceRuleSetPacketSchema,
} from "@lcsp/contracts/compliance-rule-set";

import { validPacket } from "../../../../test/support/compliance-rule-set-fixtures.js";

const { COVERED_BY_ASSESSMENT_RULES, NON_ASSESSABLE } =
  LEGAL_REQUIREMENT_COVERAGE_STATES;
const REASON_PATH = "legalRequirements.0.coverage.nonAssessableReason";

function packetWith(
  state: (typeof LEGAL_REQUIREMENT_COVERAGE_STATES)[keyof typeof LEGAL_REQUIREMENT_COVERAGE_STATES],
  nonAssessableReason: string | null,
) {
  const packet = validPacket();
  packet.legalRequirements[0].coverage = { state, nonAssessableReason };
  if (state === NON_ASSESSABLE) {
    packet.assessmentRules = packet.assessmentRules.filter(
      (rule) => !rule.legalRequirementIds.includes(packet.legalRequirements[0].legalRequirementId),
    );
  }
  return packet;
}

/**
 * The shared contract owns the structural coverage invariant the database CHECK
 * LegalPortfolioRule_coverage_reason_check also enforces. This is structure only,
 * never legal judgment.
 */
describe("compliance rule set coverage contract (shared, structural)", () => {
  it.each([
    [
      "COVERED_BY_ASSESSMENT_RULES + null",
      COVERED_BY_ASSESSMENT_RULES,
      null,
      true,
    ],
    [
      "COVERED_BY_ASSESSMENT_RULES + a reason",
      COVERED_BY_ASSESSMENT_RULES,
      "anything",
      false,
    ],
    [
      "NON_ASSESSABLE + a meaningful reason",
      NON_ASSESSABLE,
      "Organizer-run in-person duty",
      true,
    ],
    ["NON_ASSESSABLE + null", NON_ASSESSABLE, null, false],
    ["NON_ASSESSABLE + empty string", NON_ASSESSABLE, "", false],
    ["NON_ASSESSABLE + whitespace only", NON_ASSESSABLE, " \n\t ", false],
  ] as const)("%s", (_name, state, reason, accepted) => {
    const result = complianceRuleSetPacketSchema.safeParse(
      packetWith(state, reason),
    );
    expect(result.success).toBe(accepted);
    if (result.success) return;
    // The issue points at the exact nested field the model must repair.
    const paths = result.error.issues.map((issue) => issue.path.join("."));
    expect(paths).toContain(REASON_PATH);
  });

  it.each([
    [
      COVERED_BY_ASSESSMENT_RULES,
      "anything",
      /COVERED_BY_ASSESSMENT_RULES requires nonAssessableReason to be null/,
    ],
    [
      NON_ASSESSABLE,
      null,
      /NON_ASSESSABLE requires a non-blank nonAssessableReason/,
    ],
    [
      NON_ASSESSABLE,
      " \t ",
      /NON_ASSESSABLE requires a non-blank nonAssessableReason/,
    ],
  ] as const)(
    "states the structural requirement for %s + %j",
    (state, reason, expected) => {
      const result = complianceRuleSetPacketSchema.safeParse(
        packetWith(state, reason),
      );
      expect(result.success).toBe(false);
      const messages = result.success
        ? []
        : result.error.issues
            .filter((issue) => issue.path.join(".") === REASON_PATH)
            .map((issue) => issue.message);
      expect(messages.some((message) => expected.test(message))).toBe(true);
    },
  );
});

describe("compliance rule set declared coverage graph (shared, structural)", () => {
  it("accepts a NON_ASSESSABLE rule without AssessmentRule coverage", () => {
    const packet = validPacket();
    // Isolate one arbitrary declared duty; the contract never chooses its meaning.
    packet.legalRequirements = [packet.legalRequirements[4]];
    packet.assessmentRules = [];
    packet.contextRelations = [];
    expect(complianceRuleSetPacketSchema.safeParse(packet).success).toBe(true);
  });

  it("rejects an AssessmentRule reference to a NON_ASSESSABLE rule at the exact reference path", () => {
    const packet = validPacket();
    packet.assessmentRules[1].legalRequirementIds.push(
      packet.legalRequirements[4].legalRequirementId,
    );
    const result = complianceRuleSetPacketSchema.safeParse(packet);
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find(
      (issue) => issue.path.join(".") === "assessmentRules.1.legalRequirementIds.2",
    );
    expect(issue?.message).toContain("NON_ASSESSABLE");
  });

  it("accepts all covered rules with explicit AssessmentRule references, including shared coverage", () => {
    expect(complianceRuleSetPacketSchema.safeParse(validPacket()).success).toBe(
      true,
    );
  });

  it("rejects a covered rule with no AssessmentRule reference at its declaration path", () => {
    const packet = validPacket();
    packet.assessmentRules[1].legalRequirementIds.pop();
    const result = complianceRuleSetPacketSchema.safeParse(packet);
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find(
      (issue) => issue.path.join(".") === "legalRequirements.2.coverage.state",
    );
    expect(issue?.message).toContain("at least one AssessmentRule");
  });
});
