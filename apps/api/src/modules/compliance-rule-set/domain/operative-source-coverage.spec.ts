import {
  COMPLIANCE_RULE_SET_FAILURE_CODES as Errors,
  complianceRuleSetPacketSchema,
  deriveAssessmentApplicabilityGuidance,
  LEGAL_OPERATIVE_MODALITIES as Modalities,
  LEGAL_REQUIREMENT_COVERAGE_STATES as Coverage,
} from "@lcsp/contracts/compliance-rule-set";
import {
  placeholderStressPacket,
  semanticStressPacket,
  semanticStressSource,
} from "../../../../test/support/semantic-stress-fixtures.js";
import { validateComplianceRuleSetPacket } from "./compliance-rule-set-integrity.validator.js";
import {
  fixtureLegalSource,
  validPacket,
  withDerivedAssessmentSemantics,
} from "../../../../test/support/compliance-rule-set-fixtures.js";
import { authorFixtureClaims } from "../../../../test/support/legal-graph-fixtures.js";
import { fixtureDocumentGraph } from "../../../../test/support/legal-graph-fixtures.js";

const validate = (
  packet = semanticStressPacket(),
  source = semanticStressSource(),
) =>
  validateComplianceRuleSetPacket(
    complianceRuleSetPacketSchema.parse(packet),
    source,
    () => false,
  ).failures;
describe("operative source accounting", () => {
  it("rejects the reproduced valid-provenance placeholder with actionable gaps", () => {
    const failures = validate(placeholderStressPacket());
    expect(failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: Errors.OPERATIVE_PROPOSITION_REQUIRED,
          ref: "legalRequirement:LR-CONTEXT",
        }),
        expect.objectContaining({
          code: Errors.UNACCOUNTED_SEMANTIC_CLAIM,
        }),
        expect.objectContaining({ code: Errors.CLAIM_REQUIREMENT_MISMATCH }),
      ]),
    );
  });
  it("accounts for all seven semantic stress dimensions through explicit structure and context", () => {
    const packet = semanticStressPacket();
    expect(validate(packet)).toEqual([]);
    expect(packet.legalRequirements[1].operativePropositions![0].modality).toBe(
      Modalities.PROHIBITION,
    );
    expect(
      packet.legalRequirements[2].operativePropositions![0].action,
    ).toContain("compensation");
    expect(packet.legalRequirements[2].coverage.state).toBe(
      Coverage.NON_ASSESSABLE,
    );
    expect(packet.legalRequirements[0].qualifiers[0]).toContain("1 July 2026");
    expect(packet.contextRelations).toContainEqual(
      expect.objectContaining({
        fromLegalRequirementId: "LR-DELEGATE",
        toLegalRequirementId: "LR-DIRECT",
      }),
    );
    expect(packet.legalRequirements[1].exceptions[0]).toContain(
      "does not remove or delay",
    );
  });
  it("allows two source-bound compatible DUTY propositions within one Requirement", () => {
    const source = fixtureLegalSource();
    const packet = validPacket();
    const parent = packet.legalRequirements[0];
    const first = parent.operativePropositions![0];
    parent.operativePropositions!.push({
      ...structuredClone(first),
      action: "Perform a second compatible part of the same synthetic duty",
    });
    authorFixtureClaims(packet, source.documentGraph!, source.chunks);
    const operative = parent.claimBindings!.filter(
      (b) => b.role === "OPERATIVE_PROPOSITION",
    );
    expect(operative).toHaveLength(2);
    expect(new Set(operative.map((b) => b.claimId)).size).toBe(2);
    expect(
      validate(withDerivedAssessmentSemantics(packet, source), source),
    ).toEqual([]);
  });
  it("rejects aggregation of different DUTY and PROHIBITION modalities", () => {
    const packet = semanticStressPacket();
    const [direct, prohibition] = packet.legalRequirements;
    direct.operativePropositions!.push(...prohibition.operativePropositions!);
    direct.sourceRefs.push(
      ...prohibition.sourceRefs.filter(
        (ref) => !direct.sourceRefs.some((own) => own.locator === ref.locator),
      ),
    );
    direct.exceptions = prohibition.exceptions;
    packet.legalRequirements = packet.legalRequirements.filter(
      (r) => r !== prohibition,
    );
    packet.assessmentRules[1].legalRequirementIds = [direct.legalRequirementId];
    for (const relation of packet.contextRelations)
      if (relation.fromLegalRequirementId === prohibition.legalRequirementId)
        relation.fromLegalRequirementId = direct.legalRequirementId;
    for (const rule of packet.assessmentRules) {
      rule.applicabilityGuidance = deriveAssessmentApplicabilityGuidance(
        packet.legalRequirements.filter((parent) =>
          rule.legalRequirementIds.includes(parent.legalRequirementId),
        ),
      );
      for (const criterion of rule.criteria) {
        criterion.legalRequirementIds = [...rule.legalRequirementIds];
        criterion.statement = rule.applicabilityGuidance;
      }
    }
    expect(
      validate(withDerivedAssessmentSemantics(packet, semanticStressSource())),
    ).toContainEqual(
      expect.objectContaining({
        code: Errors.SEMANTIC_CLOSURE_INVALID,
        detail: "INCOMPATIBLE_OPERATIVE_AGGREGATION",
      }),
    );
  });
  it("does not let unrelated AssessmentRule citations discharge source coverage", () => {
    const packet = placeholderStressPacket();
    packet.assessmentRules[0].sourceRefs.push(
      ...packet.legalRequirements[1].sourceRefs,
    );
    expect(validate(packet)).toContainEqual(
      expect.objectContaining({ code: Errors.UNACCOUNTED_SEMANTIC_CLAIM }),
    );
  });
  it("requires operative bindings to be declared by their owner", () => {
    const packet = semanticStressPacket();
    packet.legalRequirements[0].sourceRefs =
      packet.legalRequirements[0].sourceRefs.filter(
        (r) => r.locator !== "SEM-002",
      );
    expect(validate(packet)).toContainEqual(
      expect.objectContaining({ code: Errors.OPERATIVE_SOURCE_NOT_DECLARED }),
    );
  });
  it("does not accept a relation originating from a context placeholder", () => {
    const packet = placeholderStressPacket();
    packet.contextRelations = semanticStressPacket()
      .contextRelations.slice(0, 1)
      .map((r) => ({ ...r, fromLegalRequirementId: "LR-CONTEXT" }));
    expect(validate(packet)).toContainEqual(
      expect.objectContaining({ code: Errors.UNRESOLVED_OPERATIVE_CONTEXT }),
    );
  });
  it("requires explicit leaf accounting even when a parent citation resolves", () => {
    const source = semanticStressSource();
    source.chunks.push({
      ...source.chunks[1],
      id: "child",
      locator: "SEM-002::child",
    });
    expect(validate(semanticStressPacket(), source)).toContainEqual(
      expect.objectContaining({
        code: Errors.SOURCE_STRUCTURE_REQUIRED,
      }),
    );
  });
  it("does not turn repealed material into a required current duty", () => {
    const source = semanticStressSource();
    source.chunks.push({
      ...source.chunks[1],
      id: "repealed",
      locator: "art-999",
      legalEffectStatus: "REPEALED",
    });
    source.documentGraph = fixtureDocumentGraph(
      source.legalSourceVersionId,
      source.chunks,
    );
    const packet = withDerivedAssessmentSemantics(
      semanticStressPacket(),
      source,
    );
    expect(validate(packet, source)).toEqual([]);
    packet.legalRequirements[0].operativePropositions![0].sourceRefs.push({
      ...source.chunks.at(-1)!,
    });
    expect(
      validateComplianceRuleSetPacket(packet, source, () => false).failures,
    ).toContainEqual(
      expect.objectContaining({ code: Errors.REPEALED_SOURCE_REFERENCE }),
    );
  });
  it.each(["actor", "action"])(
    "requires a nonempty %s rather than testing legal keywords",
    (field) => {
      const packet = semanticStressPacket();
      Object.assign(packet.legalRequirements[0].operativePropositions![0], {
        [field]: " ",
      });
      expect(complianceRuleSetPacketSchema.safeParse(packet).success).toBe(
        false,
      );
    },
  );
});
