import {
  LEGAL_CONTEXT_RELATION_KINDS as Relations,
  LEGAL_REQUIREMENT_CONTEXT_FIELDS as ContextFields,
} from "@lcsp/contracts/compliance-rule-set";
import {
  validPacket,
  withDerivedAssessmentSemantics,
  fixtureLegalSource,
  ref,
} from "./compliance-rule-set-fixtures.js";
export function semanticFidelityPair() {
  const packet = validPacket();
  const parent = packet.legalRequirements[0];
  parent.proposition =
    "Organization A owes the safeguards duty for identified records benefiting C; B may perform on A's behalf without replacing A's responsibility.";
  parent.operativePropositions![0].actor =
    "Organization A, duty holder and delegator; Organization B, fulfillment delegate; C, beneficiary";
  parent.operativePropositions![0].action =
    "protect only identified records for declared purpose Q, including fulfillment delegated by A to B";
  parent.applicabilityConditions = [
    "When A delegates fulfillment to B for beneficiary C following a qualifying request",
  ];
  parent.qualifiers = [
    "Only identified records processed for purpose Q in jurisdiction J",
    "For existing services after the transition ends on date T; new services immediately",
  ];
  parent.exceptions = [
    "Only while a documented specific threat exists, proportionately and until that threat ends",
  ];
  packet.contextRelations.push({
    relationId: "REL-INCORPORATION",
    kind: Relations.CROSS_REFERENCE,
    fromLegalRequirementId: "LR-DEF",
    toLegalRequirementId: "LR-RET",
    toSourceRef: null,
  });
  packet.assessmentRules[0].unresolvedConditionBindings = [
    {
      legalRequirementId: "LR-DEF",
      field: ContextFields.APPLICABILITY_CONDITION,
      index: 0,
    },
  ];
  return withDerivedAssessmentSemantics(packet);
}

export function semanticFidelityRegressionCases() {
  const good = semanticFidelityPair();
  const bad = [
    [
      "actor inversion",
      (p: typeof good) => {
        p.assessmentRules[0].criteria[0].statement =
          "Organization B owes A's duty";
      },
    ],
    [
      "modality flip",
      (p: typeof good) => {
        p.assessmentRules[0].criteria[0].statement =
          "Modality: PROHIBITION instead of DUTY";
      },
    ],
    [
      "qualifier widening",
      (p: typeof good) => {
        p.assessmentRules[0].criteria[0].statement =
          "Protect records without purpose limits";
      },
    ],
    [
      "condition deletion",
      (p: typeof good) => {
        p.assessmentRules[0].unresolvedConditions = [];
      },
    ],
    [
      "exception deletion",
      (p: typeof good) => {
        p.legalRequirements[0].exceptions = [];
      },
    ],
    [
      "temporal deletion",
      (p: typeof good) => {
        p.legalRequirements[0].qualifiers.pop();
      },
    ],
    [
      "cross-reference detachment",
      (p: typeof good) => {
        p.assessmentRules[0].contextRelationIds = [];
      },
    ],
    [
      "relation reversal",
      (p: typeof good) => {
        const r = p.contextRelations.find(
          (r) => r.relationId === "REL-INCORPORATION",
        )!;
        [r.fromLegalRequirementId, r.toLegalRequirementId] = [
          r.toLegalRequirementId!,
          r.fromLegalRequirementId,
        ];
      },
    ],
    [
      "contradictory intent",
      (p: typeof good) => {
        p.assessmentRules[0].legalIntent =
          "The opposite actor owes an unconditional prohibition";
      },
    ],
    [
      "unrelated provenance",
      (p: typeof good) => {
        p.assessmentRules[0].sourceRefs = [ref("art-6::cl-1")];
      },
    ],
    [
      "placeholder coverage",
      (p: typeof good) => {
        p.legalRequirements[0].operativePropositions = [];
      },
    ],
  ] as const;
  const narrower = structuredClone(good);
  narrower.assessmentRules[0].criteria[0].investigationFocus =
    "Repository encryption safeguard within the inherited scope";
  return {
    source: fixtureLegalSource(),
    good,
    narrower,
    bad: bad.map(([name, mutate]) => {
      const packet = structuredClone(good);
      mutate(packet);
      return { name, packet };
    }),
  };
}
