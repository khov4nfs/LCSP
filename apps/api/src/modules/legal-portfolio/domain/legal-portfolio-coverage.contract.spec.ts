import {
  LEGAL_PORTFOLIO_COVERAGE_STATES,
  legalPortfolioPacketSchema,
} from "@lcsp/contracts/legal-portfolio";

import { validPacket } from "../../../../test/support/legal-portfolio-fixtures.js";

const { COVERED_BY_ENGINEERING_RULES, NON_ASSESSABLE } =
  LEGAL_PORTFOLIO_COVERAGE_STATES;
const REASON_PATH = "legalRules.0.coverage.nonAssessableReason";

function packetWith(
  state: (typeof LEGAL_PORTFOLIO_COVERAGE_STATES)[keyof typeof LEGAL_PORTFOLIO_COVERAGE_STATES],
  nonAssessableReason: string | null,
) {
  const packet = validPacket();
  packet.legalRules[0].coverage = { state, nonAssessableReason };
  if (state === NON_ASSESSABLE) {
    packet.engineeringRules = packet.engineeringRules.filter(
      (rule) => !rule.legalRuleIds.includes(packet.legalRules[0].legalRuleId),
    );
  }
  return packet;
}

/**
 * The shared contract owns the structural coverage invariant the database CHECK
 * LegalPortfolioRule_coverage_reason_check also enforces. This is structure only,
 * never legal judgment.
 */
describe("legal portfolio coverage contract (shared, structural)", () => {
  it.each([
    [
      "COVERED_BY_ENGINEERING_RULES + null",
      COVERED_BY_ENGINEERING_RULES,
      null,
      true,
    ],
    [
      "COVERED_BY_ENGINEERING_RULES + a reason",
      COVERED_BY_ENGINEERING_RULES,
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
    const result = legalPortfolioPacketSchema.safeParse(
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
      COVERED_BY_ENGINEERING_RULES,
      "anything",
      /COVERED_BY_ENGINEERING_RULES requires nonAssessableReason to be null/,
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
      const result = legalPortfolioPacketSchema.safeParse(
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

describe("legal portfolio declared coverage graph (shared, structural)", () => {
  it("accepts a NON_ASSESSABLE rule without EngineeringRule coverage", () => {
    const packet = validPacket();
    // Isolate one arbitrary declared duty; the contract never chooses its meaning.
    packet.legalRules = [packet.legalRules[4]];
    packet.engineeringRules = [];
    packet.contextRelations = [];
    expect(legalPortfolioPacketSchema.safeParse(packet).success).toBe(true);
  });

  it("rejects an EngineeringRule reference to a NON_ASSESSABLE rule at the exact reference path", () => {
    const packet = validPacket();
    packet.engineeringRules[1].legalRuleIds.push(
      packet.legalRules[4].legalRuleId,
    );
    const result = legalPortfolioPacketSchema.safeParse(packet);
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find(
      (issue) => issue.path.join(".") === "engineeringRules.1.legalRuleIds.2",
    );
    expect(issue?.message).toContain("NON_ASSESSABLE");
  });

  it("accepts all covered rules with explicit EngineeringRule references, including shared coverage", () => {
    expect(legalPortfolioPacketSchema.safeParse(validPacket()).success).toBe(
      true,
    );
  });

  it("rejects a covered rule with no EngineeringRule reference at its declaration path", () => {
    const packet = validPacket();
    packet.engineeringRules[1].legalRuleIds.pop();
    const result = legalPortfolioPacketSchema.safeParse(packet);
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find(
      (issue) => issue.path.join(".") === "legalRules.2.coverage.state",
    );
    expect(issue?.message).toContain("at least one EngineeringRule");
  });
});
