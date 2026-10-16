import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  LEGAL_CONTEXT_RELATION_KINDS as Relations,
  LEGAL_OPERATIVE_MODALITIES as Modalities,
  LEGAL_REQUIREMENT_COVERAGE_STATES as Coverage,
  deriveAssessmentApplicabilityGuidance,
  type ComplianceRuleSetPacket,
  type LegalRequirementInput,
} from "@lcsp/contracts/compliance-rule-set";
import type { LegalSourceSnapshot } from "../../src/modules/compliance-rule-set/domain/compliance-rule-set-integrity.validator.js";
import { validPacket } from "./compliance-rule-set-fixtures.js";

export const semanticStressSourceInput = JSON.parse(
  readFileSync(
    new URL(
      "../../../../tests/fixtures/rule-set-semantic-stress.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  documentId: string;
  provenance: string;
  provisions: Array<{ locator: string; content: string }>;
};
export const semanticStressRefs = semanticStressSourceInput.provisions.map(
  (p) => ({
    documentId: semanticStressSourceInput.documentId,
    locator: p.locator,
    contentSha256: `sha256:${createHash("sha256").update(p.content).digest("hex")}`,
  }),
);
const refs = (...ordinals: number[]) =>
  ordinals.map((n) => semanticStressRefs[n - 1]);

export function semanticStressSource(): LegalSourceSnapshot {
  return {
    legalSourceVersionId: "synthetic-semantic-stress-version",
    retrievalIndexValid: true,
    chunks: semanticStressRefs.map((ref) => ({
      ...ref,
      id: ref.locator,
      legalStatus: "ACTIVE",
      legalEffectStatus: "EFFECTIVE",
      legalStatusSourceRef: semanticStressSourceInput.provenance,
      sourceEffectStatus: "IN_FORCE",
    })),
  };
}

export function semanticStressPacket(): ComplianceRuleSetPacket {
  const requirement = (
    id: string,
    proposition: string,
    actor: string,
    modality: (typeof Modalities)[keyof typeof Modalities],
    action: string,
    operativeSource: number,
    allSources: number[],
    nonRepositoryDuty = false,
  ): LegalRequirementInput => ({
    legalRequirementId: id,
    title: id,
    proposition,
    operativePropositions: [
      { actor, modality, action, sourceRefs: refs(operativeSource) },
    ],
    applicabilityConditions: [
      "Covered service stores customer-created records and supplies a digital customer interface; operator controls that service",
    ],
    qualifiers: [],
    exceptions: [],
    nonRepositoryDuty,
    sourceRefs: refs(...allSources),
    coverage: nonRepositoryDuty
      ? {
          state: Coverage.NON_ASSESSABLE,
          nonAssessableReason:
            "Actual external performance cannot be established from repository evidence",
        }
      : {
          state: Coverage.COVERED_BY_ASSESSMENT_RULES,
          nonAssessableReason: null,
        },
  });
  const direct = requirement(
    "LR-DIRECT",
    "The covered service operator must provide all customer-created records as an interoperable machine-readable portable copy within seven calendar days of a customer request.",
    "Operator controlling a covered service",
    Modalities.DUTY,
    "Provide the requesting customer a portable copy of all customer-created records within seven calendar days",
    2,
    [1, 2, 5],
  );
  direct.qualifiers.push(
    "Existing services operating before 1 January 2026 comply from 1 July 2026; services first operating on or after 1 January 2026 comply immediately on first operation",
  );
  const prohibition = requirement(
    "LR-PROHIBITION",
    "The operator must not impose commercial charges or technical obstacles intended to prevent customer record portability, subject only to the limited documented security-threat exception.",
    "Operator controlling a covered service",
    Modalities.PROHIBITION,
    "Impose commercial charges or technical obstacles intended to prevent a customer's transfer of customer-created records to another service",
    3,
    [1, 3, 5, 7],
  );
  prohibition.qualifiers.push(...direct.qualifiers);
  prohibition.exceptions.push(
    "Temporary proportionate block only while a documented specific security threat makes the transfer unsafe; end the block when that threat ends. This does not remove or delay the separate portable-copy duty",
  );
  const compensation = requirement(
    "LR-COMPENSATION",
    "If failure to provide the required copy causes documented financial loss, the operator must pay compensation for that loss within thirty calendar days of receiving notice; a policy alone is insufficient.",
    "Covered service operator whose failure causes loss",
    Modalities.DUTY,
    "Pay the affected customer compensation for the documented financial loss within thirty calendar days of notice",
    4,
    [1, 2, 4],
    true,
  );
  compensation.applicabilityConditions.push(
    "Failure of the applicable SEM-002 portable-copy duty causes the customer documented financial loss and the operator receives notice of that loss",
  );
  const delegated = requirement(
    "LR-DELEGATE",
    "The delegated external export provider must fulfil the same portable-copy duty, definitions and seven-calendar-day period as the operator; delegation does not release the operator.",
    "External export provider to whom the covered service operator delegates fulfilment",
    Modalities.DUTY,
    "Provide the requesting customer all customer-created records as an interoperable machine-readable portable copy within the same seven-calendar-day period as SEM-002",
    6,
    [1, 2, 6],
    true,
  );
  delegated.applicabilityConditions.push(
    "Operator delegates export-request fulfilment to the external provider",
  );
  const ar = (
    id: string,
    requirementId: string,
    meaning: string,
    sources: number[],
  ) => ({
    ...validPacket().assessmentRules[0],
    assessmentRuleId: id,
    legalRequirementIds: [requirementId],
    concept: meaning,
    legalIntent: meaning,
    applicabilityGuidance:
      direct.applicabilityConditions.join("; ") +
      "; " +
      direct.qualifiers.join("; "),
    criteria: [{ criterionId: "C-1", statement: meaning }],
    investigationGoals: [meaning],
    requiredEvidence: [meaning],
    sourceRefs: refs(...sources),
  });
  const sourceRelation = (
    id: string,
    kind: (typeof Relations)[keyof typeof Relations],
    owner: string,
    source: number,
  ) => ({
    relationId: id,
    kind,
    fromLegalRequirementId: owner,
    toLegalRequirementId: null,
    toSourceRef: refs(source)[0],
  });
  const incorporation = (id: string, owner: string) => ({
    relationId: id,
    kind: Relations.CROSS_REFERENCE,
    fromLegalRequirementId: owner,
    toLegalRequirementId: direct.legalRequirementId,
    toSourceRef: null,
  });
  const packet: ComplianceRuleSetPacket = {
    legalRequirements: [direct, prohibition, compensation, delegated],
    assessmentRules: [
      ar("AR-DIRECT", direct.legalRequirementId, direct.proposition, [1, 2, 5]),
      ar(
        "AR-PROHIBITION",
        prohibition.legalRequirementId,
        prohibition.proposition + " " + prohibition.exceptions[0],
        [1, 3, 5, 7],
      ),
    ],
    contextRelations: [
      ...[direct, prohibition, compensation, delegated].map((r, n) =>
        sourceRelation(
          `REL-DEF-${n}`,
          Relations.DEFINITION,
          r.legalRequirementId,
          1,
        ),
      ),
      sourceRelation(
        "REL-TIME-DIRECT",
        Relations.QUALIFIER,
        direct.legalRequirementId,
        5,
      ),
      sourceRelation(
        "REL-TIME-PROHIBITION",
        Relations.QUALIFIER,
        prohibition.legalRequirementId,
        5,
      ),
      sourceRelation(
        "REL-EXCEPTION",
        Relations.EXCEPTION,
        prohibition.legalRequirementId,
        7,
      ),
      incorporation(
        "REL-COMPENSATION-TRIGGER",
        compensation.legalRequirementId,
      ),
      incorporation("REL-INCORPORATES-DIRECT", delegated.legalRequirementId),
    ],
  };
  for (const rule of packet.assessmentRules) {
    rule.applicabilityGuidance = deriveAssessmentApplicabilityGuidance(
      packet.legalRequirements.filter((parent) =>
        rule.legalRequirementIds.includes(parent.legalRequirementId),
      ),
    );
  }
  return packet;
}

/** The historical mechanism: one actual duty plus provenance-only NON_ASSESSABLE context. */
export function placeholderStressPacket(): ComplianceRuleSetPacket {
  const packet = semanticStressPacket();
  packet.legalRequirements = packet.legalRequirements.slice(0, 1);
  packet.legalRequirements[0].sourceRefs = refs(2);
  packet.legalRequirements[0].qualifiers = [];
  packet.assessmentRules = packet.assessmentRules.slice(0, 1);
  packet.assessmentRules[0].sourceRefs = refs(2);
  packet.contextRelations = [];
  packet.legalRequirements.push({
    legalRequirementId: "LR-CONTEXT",
    title: "Context coverage",
    proposition:
      "General contextual framework for portable services, remedies and implementation.",
    applicabilityConditions: ["Mechanical coverage placeholder"],
    qualifiers: [],
    exceptions: [],
    nonRepositoryDuty: true,
    sourceRefs: refs(1, 3, 4, 5, 6, 7),
    coverage: {
      state: Coverage.NON_ASSESSABLE,
      nonAssessableReason:
        "Organizational and transitional context is not repository-assessable",
    },
  });
  return packet;
}
