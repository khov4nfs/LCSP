import { semanticFidelityPair as completePair } from "../../../../test/support/semantic-fidelity-fixtures.js";
import {
  COMPLIANCE_RULE_SET_FAILURE_CODES as Gaps,
  LEGAL_OPERATIVE_MODALITIES as Modalities,
  LEGAL_CONTEXT_RELATION_KINDS as Relations,
  complianceRuleSetPacketSchema,
  assessmentSemanticContext,
  deriveAssessmentApplicabilityGuidance,
  COMPLIANCE_RULE_SET_LIMITS,
} from "@lcsp/contracts/compliance-rule-set";
import {
  fixtureLegalSource,
  ref,
  withDerivedAssessmentSemantics,
} from "../../../../test/support/compliance-rule-set-fixtures.js";
import {
  placeholderStressPacket,
  semanticStressPacket,
  semanticStressSource,
} from "../../../../test/support/semantic-stress-fixtures.js";
import { validateComplianceRuleSetPacket } from "./compliance-rule-set-integrity.validator.js";

const failures = (p: ReturnType<typeof completePair>) =>
  validateComplianceRuleSetPacket(p, fixtureLegalSource(), () => false)
    .failures;

describe("complete semantic fidelity matrix", () => {
  it("rejects unrelated child provenance while permitting an inherited evidence subset", () => {
    const p = completePair();
    p.assessmentRules[0].sourceRefs = [ref("art-6::cl-1")];
    expect(failures(p)).toContainEqual(
      expect.objectContaining({
        code: Gaps.APPLICABILITY_BINDING_MISMATCH,
        ref: "assessmentRule:ER-DEF|field:sourceRefs",
      }),
    );
  });
  it("renders a maximal parent context fact without losing text on repeated parsing", () => {
    const packet = completePair();
    packet.legalRequirements[0].applicabilityConditions = [
      "x".repeat(COMPLIANCE_RULE_SET_LIMITS.maxShortTextLength),
    ];
    const good = withDerivedAssessmentSemantics(packet);
    expect(complianceRuleSetPacketSchema.parse(good)).toEqual(good);
  });
  it("preserves transitive dependency direction, terminates cycles and ignores input ordering", () => {
    const packet = completePair();
    packet.contextRelations.push({
      relationId: "REL-CYCLE",
      kind: Relations.CROSS_REFERENCE,
      fromLegalRequirementId: "LR-RET",
      toLegalRequirementId: "LR-DEF",
      toSourceRef: null,
    });
    const root = [packet.legalRequirements[0]];
    const context = assessmentSemanticContext(
      root,
      packet.contextRelations,
      packet.legalRequirements,
    );
    expect(
      new Set(context.requirements.map((r) => r.legalRequirementId)).size,
    ).toBe(context.requirements.length);
    expect(context.relations.some((r) => r.relationId === "REL-CYCLE")).toBe(
      true,
    );
    expect(
      deriveAssessmentApplicabilityGuidance(
        root,
        packet.contextRelations,
        packet.legalRequirements,
      ),
    ).toBe(
      deriveAssessmentApplicabilityGuidance(
        root,
        [...packet.contextRelations].reverse(),
        [...packet.legalRequirements].reverse(),
      ),
    );
  });
  it("rejects foreign, out-of-range and duplicate unresolved fact bindings", () => {
    for (const kind of ["FOREIGN", "OUT_OF_RANGE", "DUPLICATE"]) {
      const packet = completePair();
      const bindings = packet.assessmentRules[0].unresolvedConditionBindings!;
      if (kind === "FOREIGN") bindings[0].legalRequirementId = "LR-PERSON";
      if (kind === "OUT_OF_RANGE") bindings[0].index = 100;
      if (kind === "DUPLICATE") bindings.push({ ...bindings[0] });
      expect(failures(packet)).toContainEqual(
        expect.objectContaining({ code: Gaps.APPLICABILITY_BINDING_MISMATCH }),
      );
    }
  });
  it.each([
    ["P1 direct duty", Modalities.DUTY],
    ["P2 direct prohibition", Modalities.PROHIBITION],
    ["P3 qualified prohibition", Modalities.PROHIBITION],
    ["P4 conditional duty", Modalities.DUTY],
    ["P5 compensation/remedy", Modalities.DUTY],
    ["P6 exception", Modalities.PERMISSION],
    ["P7 temporal transition", Modalities.DUTY],
    ["P8 incorporated cross-reference", Modalities.DUTY],
    ["P9 delegated fulfillment", Modalities.DUTY],
    ["P10 multiple actors", Modalities.DUTY],
  ])("%s preserves complete parent context and sources", (_name, modality) => {
    const packet = completePair();
    packet.legalRequirements[0].operativePropositions![0].modality = modality;
    if (_name === "P5 compensation/remedy")
      packet.legalRequirements[0].operativePropositions![0].action =
        "provide the conditional remedy to beneficiary C within the stated period";
    const good = withDerivedAssessmentSemantics(packet);
    expect(failures(good)).toEqual([]);
    expect(
      complianceRuleSetPacketSchema.parse(JSON.parse(JSON.stringify(good))),
    ).toEqual(good);
  });
  it("P11 accepts legitimate technical narrowing beneath the inherited predicate", () => {
    const packet = completePair();
    packet.assessmentRules[0].criteria[0].investigationFocus =
      "Evaluate repository encryption safeguards for the selected storage surface";
    expect(failures(packet)).toEqual([]);
  });
  it("P12 rejects combining a DUTY and PROHIBITION as if they were compatible operative claims", () => {
    const packet = semanticStressPacket();
    const [direct, prohibition] = packet.legalRequirements;
    const previousOperativeCount = direct.operativePropositions!.length;
    direct.operativePropositions!.push(...prohibition.operativePropositions!);
    // The new gate must see both operative anchors, not merely two copied text rows.
    direct.claimBindings!.push(...prohibition.claimBindings!.filter((b) => b.role === "OPERATIVE_PROPOSITION").map((b) => ({...b, index: previousOperativeCount + b.index})));
    direct.sourceRefs.push(
      ...prohibition.sourceRefs.filter(
        (r) => !direct.sourceRefs.some((x) => x.locator === r.locator),
      ),
    );
    direct.qualifiers.push(...prohibition.qualifiers);
    direct.exceptions.push(...prohibition.exceptions);
    packet.legalRequirements = packet.legalRequirements.filter(
      (r) => r !== prohibition,
    );
    for (const rule of packet.assessmentRules) {
      rule.legalRequirementIds = rule.legalRequirementIds.map((id) =>
        id === prohibition.legalRequirementId ? direct.legalRequirementId : id,
      );
      for (const c of rule.criteria)
        c.legalRequirementIds = [...rule.legalRequirementIds];
    }
    for (const r of packet.contextRelations)
      if (r.fromLegalRequirementId === prohibition.legalRequirementId)
        r.fromLegalRequirementId = direct.legalRequirementId;
    expect(
      validateComplianceRuleSetPacket(
        withDerivedAssessmentSemantics(packet, semanticStressSource()),
        semanticStressSource(),
        () => false,
      ).failures,
    ).toContainEqual(expect.objectContaining({
      code: Gaps.SEMANTIC_CLOSURE_INVALID,
      detail: "INCOMPATIBLE_OPERATIVE_AGGREGATION",
    }));
  });
  it.each([
    ["N1 actor reversed", "Actor: Organization B owes A's duty"],
    ["N2 delegation reversed", "Organization B delegates fulfillment to A"],
    ["N3 polarity flipped", "Modality: PROHIBITION instead of DUTY"],
    [
      "N4 purpose qualifier dropped",
      "Protect all records without purpose limits",
    ],
    ["N5 trigger dropped", "Duty applies unconditionally"],
    ["N6 exception dropped", "No exception limits apply"],
    ["N7 temporal bound dropped", "Duty applies at all times"],
    ["N9 object scope broadened", "Protect every record in every jurisdiction"],
  ])(
    "%s rejects a contradictory downstream normative statement",
    (_name, badText) => {
      const packet = completePair();
      packet.assessmentRules[0].criteria[0].statement = badText;
      expect(failures(packet)).toContainEqual(
        expect.objectContaining({ code: Gaps.APPLICABILITY_BINDING_MISMATCH }),
      );
    },
  );
  it("N8 rejects detached incorporated dependencies and reversed relation direction", () => {
    for (const reverse of [false, true]) {
      const packet = completePair();
      const edge = packet.contextRelations.find(
        (r) => r.relationId === "REL-INCORPORATION",
      )!;
      if (reverse)
        [edge.fromLegalRequirementId, edge.toLegalRequirementId] = [
          edge.toLegalRequirementId!,
          edge.fromLegalRequirementId,
        ];
      else packet.assessmentRules[0].contextRelationIds = [];
      expect(failures(packet)).toContainEqual(
        expect.objectContaining({ code: Gaps.APPLICABILITY_BINDING_MISMATCH }),
      );
    }
  });
  it("N10 rejects the historical provenance-only placeholder class", () => {
    const p = placeholderStressPacket();
    expect(
      validateComplianceRuleSetPacket(
        complianceRuleSetPacketSchema.parse(p),
        semanticStressSource(),
        () => false,
      ).failures,
    ).toContainEqual(
      expect.objectContaining({ code: Gaps.OPERATIVE_PROPOSITION_REQUIRED }),
    );
  });
  it("N11 rejects contradictory guidance, intent and unresolved applicability text", () => {
    for (const field of [
      "applicabilityGuidance",
      "legalIntent",
      "unresolvedConditions",
    ] as const) {
      const p = completePair();
      if (field === "unresolvedConditions")
        p.assessmentRules[0][field] = [
          "B delegates to A with no triggering condition",
        ];
      else
        p.assessmentRules[0][field] =
          "B owes the opposite unconditional obligation";
      expect(failures(p)).toContainEqual(
        expect.objectContaining({ code: Gaps.APPLICABILITY_BINDING_MISMATCH }),
      );
    }
  });
  it("N12 rejects a context relation used as a normative parent instead of an operative requirement", () => {
    const p = completePair();
    p.assessmentRules[0].criteria[0].legalRequirementIds = ["REL-DEF"];
    expect(failures(p)).toContainEqual(
      expect.objectContaining({ code: Gaps.APPLICABILITY_BINDING_MISMATCH }),
    );
  });
  it.each([
    "actor",
    "modality",
    "action",
    "condition",
    "qualifier",
    "exception",
    "transition",
    "source",
    "dependency",
  ])(
    "metamorphic: stale child cannot survive parent %s mutation",
    (dimension) => {
      const p = completePair();
      const parent = p.legalRequirements[0];
      if (dimension === "actor")
        parent.operativePropositions![0].actor = "Another duty holder";
      if (dimension === "modality")
        parent.operativePropositions![0].modality = Modalities.PROHIBITION;
      if (dimension === "action")
        parent.operativePropositions![0].action = "Different action";
      if (dimension === "condition") parent.applicabilityConditions = [];
      if (dimension === "qualifier") parent.qualifiers.shift();
      if (dimension === "exception") parent.exceptions = [];
      if (dimension === "transition") parent.qualifiers.pop();
      if (dimension === "source")
        parent.sourceRefs[0].contentSha256 = `sha256:${"f".repeat(64)}`;
      if (dimension === "dependency")
        p.contextRelations = p.contextRelations.filter(
          (r) => r.relationId !== "REL-INCORPORATION",
        );
      expect(failures(p)).toContainEqual(
        expect.objectContaining({ code: Gaps.APPLICABILITY_BINDING_MISMATCH }),
      );
    },
  );
});
