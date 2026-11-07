/** Adversarial controls for claim-scope projection. This suite does not approve legal meaning. */
import { describe, expect, it } from "@jest/globals";
import type {
  LegalSemanticGraph,
  PreparationClaimStageDecision,
  ComplianceRuleSetPacket,
} from "@lcsp/contracts/compliance-rule-set";
import {
  reviewDevelopmentClaims,
  validateDevelopmentPacket,
} from "./development-scope-review.js";

const source = "11111111-1111-4111-8111-111111111111";
const node = "a".repeat(64);
const operative = (id: string, actor: string, action: string) => ({
  claimId: id,
  legalSourceVersionId: source,
  sourceNodeIds: [node],
  state: "RELEVANT",
  semanticAuthority: "LEGAL_NORMATIVE",
  claimType: "DUTY",
  statement: action,
  operative: { actor, modality: "DUTY", action },
  nonOperativeReason: null,
});
const fixture = () => {
  const graph = {
    contractVersion: "LEGAL_GRAPH_V3",
    materializationId: "b".repeat(64),
    legalSourceVersionId: source,
    claims: [
      operative("dev", "Developer", "Design an audit log"),
      operative("operator", "Operator", "File an operations report"),
      {
        ...operative("condition", "Legislator", "Legal condition"),
        semanticAuthority: "CONTEXT",
        claimType: "CONDITION",
        operative: null,
      },
      {
        ...operative("unrelated", "Legislator", "Background"),
        semanticAuthority: "CONTEXT",
        claimType: "CONTEXT",
        operative: null,
      },
    ],
    relations: [
      {
        relationId: "r-condition",
        kind: "CONDITION_OF",
        fromClaimId: "condition",
        toClaimId: "dev",
        referenceId: null,
      },
    ],
    sourceAccounting: [],
    referenceAccounting: [],
  } as unknown as LegalSemanticGraph;
  const decisions = [
    {
      claimId: "dev",
      legalSourceVersionId: source,
      sourceNodeIds: [node],
      actor: "Developer",
      modality: "DUTY",
      action: "Design an audit log",
      stage: "DEVELOPMENT",
      reason: "Design-time software obligation",
    },
    {
      claimId: "operator",
      legalSourceVersionId: source,
      sourceNodeIds: [node],
      actor: "Operator",
      modality: "DUTY",
      action: "File an operations report",
      stage: "NON_DEVELOPMENT",
      reason: "Operator's external activity",
    },
  ] as PreparationClaimStageDecision[];
  return { graph, decisions };
};

describe("scope governance", () => {
  it("accounts all duties but retains only developer rule and directed material context", () => {
    const { graph, decisions } = fixture();
    const result = reviewDevelopmentClaims(graph, decisions);
    expect(result.developmentClaimIds).toEqual(["dev"]);
    expect(result.outOfScopeClaimIds).toEqual(["operator"]);
    expect(result.materialContextClaimIds).toEqual(["condition"]);
    expect(result.materialContextClaimIds).not.toContain("unrelated");
    expect(result.releaseEligible).toBe(false);
  });

  it("fails closed on missing, duplicate, and wrong-actor decisions", () => {
    const { graph, decisions } = fixture();
    expect(() => reviewDevelopmentClaims(graph, decisions.slice(1))).toThrow(
      /UNACCOUNTED/,
    );
    expect(() =>
      reviewDevelopmentClaims(graph, [
        decisions[0],
        decisions[0],
        decisions[1],
      ]),
    ).toThrow(/DUPLICATE/);
    expect(() =>
      reviewDevelopmentClaims(graph, [
        { ...decisions[0], actor: "Operator" },
        decisions[1],
      ]),
    ).toThrow(/PROVENANCE/);
  });

  it("rejects unpinned material modifiers, including a foreign legal source", () => {
    const { graph, decisions } = fixture();
    graph.claims[2].legalSourceVersionId =
      "22222222-2222-4222-8222-222222222222";
    expect(() => reviewDevelopmentClaims(graph, decisions)).toThrow(
      /MATERIAL_UNPINNED/,
    );
  });

  it("requires splitting mixed operator/developer requirements", () => {
    const { graph, decisions } = fixture();
    const projection = reviewDevelopmentClaims(graph, decisions);
    const packet = {
      semanticGraph: graph,
      legalRequirements: [
        {
          legalRequirementId: "mixed",
          claimBindings: [
            { claimId: "dev", role: "OPERATIVE_PROPOSITION", index: 0 },
            { claimId: "operator", role: "OPERATIVE_PROPOSITION", index: 1 },
          ],
          coverage: {
            state: "COVERED_BY_ASSESSMENT_RULES",
            nonAssessableReason: null,
          },
        },
      ],
      assessmentRules: [
        { assessmentRuleId: "rule", legalRequirementIds: ["mixed"] },
      ],
      contextRelations: [],
    } as unknown as ComplianceRuleSetPacket;
    expect(() => validateDevelopmentPacket(packet, projection)).toThrow(
      /MIXED_STAGE/,
    );
  });

  it("rejects deployment rule leakage and omitted development criteria", () => {
    const { graph, decisions } = fixture();
    const projection = reviewDevelopmentClaims(graph, decisions);
    const packet = {
      semanticGraph: graph,
      legalRequirements: [
        {
          legalRequirementId: "dev-req",
          claimBindings: [
            { claimId: "dev", role: "OPERATIVE_PROPOSITION", index: 0 },
          ],
          coverage: {
            state: "COVERED_BY_ASSESSMENT_RULES",
            nonAssessableReason: null,
          },
        },
        {
          legalRequirementId: "ops-req",
          claimBindings: [
            { claimId: "operator", role: "OPERATIVE_PROPOSITION", index: 0 },
          ],
          coverage: {
            state: "NON_ASSESSABLE",
            nonAssessableReason: "OUT_OF_SCOPE_TARGET: operator-only",
          },
        },
      ],
      assessmentRules: [
        { assessmentRuleId: "r1", legalRequirementIds: ["ops-req"] },
      ],
      contextRelations: [],
    } as unknown as ComplianceRuleSetPacket;
    expect(() => validateDevelopmentPacket(packet, projection)).toThrow(
      /DEPLOYMENT_RULE_LEAK/,
    );
    packet.assessmentRules = [];
    expect(() => validateDevelopmentPacket(packet, projection)).toThrow(
      /DEVELOPMENT_DUTY_OMITTED/,
    );
  });
});
