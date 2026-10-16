import {
  LEGAL_CONTEXT_RELATION_KINDS,
  LEGAL_REQUIREMENT_COVERAGE_STATES,
  LEGAL_OPERATIVE_MODALITIES,
  deriveAssessmentApplicabilityGuidance,
  complianceRuleSetPacketSchema,
  type ComplianceRuleSetPacket,
  type ComplianceRuleSetSourceRef,
} from "@lcsp/contracts/compliance-rule-set";

import type {
  LegalSourceChunkSnapshot,
  LegalSourceSnapshot,
} from "../../src/modules/compliance-rule-set/domain/compliance-rule-set-integrity.validator.js";

/** Same hierarchy as the prepared synthetic notice fixture (art-1 .. art-6). */
export const FIXTURE_DOCUMENT_ID = "SYNTHETIC-NOTICE-INSTRUMENT";
export const FIXTURE_LOCATORS = [
  "art-1",
  "art-1::cl-1",
  "art-2",
  "art-2::cl-1",
  "art-3",
  "art-3::cl-1",
  "art-4",
  "art-4::cl-1",
  "art-4::cl-1::pt-a",
  "art-5",
  "art-5::cl-1",
  "art-5::cl-1::pt-a",
  "art-5::cl-1::pt-b",
  "art-6",
  "art-6::cl-1",
] as const;

export function fixtureHash(locator: string, variant = "v1"): string {
  // deterministic 64-hex stand-in for a content hash
  let hex = "";
  let seed = 0;
  for (const char of `${variant}|${locator}`)
    seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  while (hex.length < 64) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    hex += seed.toString(16).padStart(8, "0");
  }
  return `sha256:${hex.slice(0, 64)}`;
}

export function fixtureChunks(
  variant = "v1",
  overrides: Partial<Record<string, Partial<LegalSourceChunkSnapshot>>> = {},
): LegalSourceChunkSnapshot[] {
  return FIXTURE_LOCATORS.map((locator) => ({
    id: `${variant}-${locator}`,
    documentId: FIXTURE_DOCUMENT_ID,
    locator,
    contentSha256: fixtureHash(
      locator,
      variant === "v2" && locator === "art-5::cl-1" ? "v2" : "v1",
    ),
    legalStatus: "ACTIVE",
    legalEffectStatus: "EFFECTIVE",
    legalStatusSourceRef: "source-metadata:fixture",
    sourceEffectStatus: "IN_FORCE",
    ...overrides[locator],
  }));
}

export function fixtureLegalSource(
  overrides: Partial<LegalSourceSnapshot> = {},
  chunkOverrides: Partial<
    Record<string, Partial<LegalSourceChunkSnapshot>>
  > = {},
): LegalSourceSnapshot {
  return {
    legalSourceVersionId: "legalSource-v1",
    retrievalIndexValid: true,
    chunks: fixtureChunks("v1", chunkOverrides),
    ...overrides,
  };
}

export function ref(
  locator: string,
  variant = "v1",
): ComplianceRuleSetSourceRef {
  return {
    documentId: FIXTURE_DOCUMENT_ID,
    locator,
    contentSha256: fixtureHash(locator, variant),
  };
}

const LEAVES = [
  "art-1::cl-1",
  "art-2::cl-1",
  "art-3::cl-1",
  "art-4::cl-1::pt-a",
  "art-5::cl-1::pt-a",
  "art-5::cl-1::pt-b",
  "art-6::cl-1",
] as const;

function legalRequirement(
  legalRequirementId: string,
  locators: readonly string[],
  coverage: "covered" | "nonAssessable" = "covered",
  nonRepositoryDuty = false,
) {
  return {
    legalRequirementId,
    title: `Rule ${legalRequirementId}`,
    proposition: `Proposition for ${legalRequirementId}.`,
    operativePropositions: [
      {
        actor: "The operator addressed by the synthetic provision",
        modality: LEGAL_OPERATIVE_MODALITIES.DUTY,
        action: `Perform the synthetic duty ${legalRequirementId}`,
        sourceRefs: locators.map((locator) => ref(locator)),
      },
    ],
    applicabilityConditions:
      coverage === "covered"
        ? [
            `Applies to the system that stores the records of ${legalRequirementId}.`,
          ]
        : [],
    qualifiers: [],
    exceptions: [],
    nonRepositoryDuty,
    sourceRefs: locators.map((locator) => ref(locator)),
    coverage:
      coverage === "covered"
        ? {
            state:
              LEGAL_REQUIREMENT_COVERAGE_STATES.COVERED_BY_ASSESSMENT_RULES,
            nonAssessableReason: null,
          }
        : {
            state: LEGAL_REQUIREMENT_COVERAGE_STATES.NON_ASSESSABLE,
            nonAssessableReason:
              "Duty cannot be established from a repository.",
          },
  };
}

function assessmentRule(
  assessmentRuleId: string,
  legalRequirementIds: string[],
  locators: readonly string[],
) {
  return {
    assessmentRuleId,
    legalRequirementIds,
    concept: `Concept ${assessmentRuleId}`,
    legalIntent: "Ensure the legal intent is met.",
    applicabilityGuidance: "Applies when the described condition holds.",
    criteria: [{ criterionId: "C-1", statement: "The control exists." }],
    investigationGoals: ["find the control"],
    startingNodeTypes: [],
    targetNodeTypes: [],
    edgeStrategies: [],
    graphQueries: [],
    keywords: [],
    commonApis: [],
    commonLibraries: [],
    patterns: [],
    requiredEvidence: ["control implementation"],
    supportingEvidence: [],
    negativeEvidence: [],
    unresolvedConditions: [],
    sourceRefs: locators.map((locator) => ref(locator)),
  };
}

/** A complete packet: every leaf provision cited, one non-repository duty, one context relation. */
export function validPacket(): ComplianceRuleSetPacket {
  const packet: ComplianceRuleSetPacket = {
    legalRequirements: [
      legalRequirement("LR-DEF", ["art-1::cl-1"]),
      legalRequirement("LR-RET", ["art-5::cl-1::pt-a", "art-5::cl-1::pt-b"]),
      legalRequirement("LR-EXC", ["art-3::cl-1"]),
      legalRequirement("LR-XREF", ["art-4::cl-1::pt-a", "art-2::cl-1"]),
      legalRequirement("LR-PERSON", ["art-6::cl-1"], "nonAssessable", true),
    ],
    assessmentRules: [
      assessmentRule("ER-DEF", ["LR-DEF"], ["art-1::cl-1"]),
      assessmentRule(
        "ER-RET",
        ["LR-RET", "LR-EXC"],
        ["art-5::cl-1::pt-a", "art-3::cl-1"],
      ),
      assessmentRule("ER-XREF", ["LR-XREF"], ["art-4::cl-1::pt-a"]),
    ],
    contextRelations: [
      {
        relationId: "REL-EXC",
        kind: LEGAL_CONTEXT_RELATION_KINDS.EXCEPTION,
        fromLegalRequirementId: "LR-RET",
        toLegalRequirementId: "LR-EXC",
        toSourceRef: null,
      },
      {
        relationId: "REL-DEF",
        kind: LEGAL_CONTEXT_RELATION_KINDS.DEFINITION,
        fromLegalRequirementId: "LR-XREF",
        toLegalRequirementId: null,
        toSourceRef: ref("art-1::cl-1"),
      },
    ],
  };
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
  return withDerivedAssessmentSemantics(packet);
}

/** Fixture authoring uses omitted derived fields; negative tests mutate the resulting bindings. */
export function withDerivedAssessmentSemantics(
  packet: ComplianceRuleSetPacket,
): ComplianceRuleSetPacket {
  return complianceRuleSetPacketSchema.parse({
    ...packet,
    assessmentRules: packet.assessmentRules.map(
      ({
        applicabilityGuidance,
        legalIntent,
        contextRelationIds,
        unresolvedConditions,
        ...rule
      }) => {
        void applicabilityGuidance;
        void legalIntent;
        void contextRelationIds;
        void unresolvedConditions;
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
}

export const FIXTURE_LEAVES = LEAVES;

/** Minimal Prisma surface the DB legalSource factory needs (keeps this support file client-agnostic). */
type LegalSourcePrisma = {
  legalSourceVersion: {
    create(args: unknown): Promise<{ id: string; version: string }>;
  };
  legalSourceDocument: { create(args: unknown): Promise<{ id: string }> };
  legalDocumentChunk: { createMany(args: unknown): Promise<unknown> };
  legalRetrievalIndex: { create(args: unknown): Promise<unknown> };
};

/**
 * Builds a Legal Source Version mirroring the fixture hierarchy in PostgreSQL. `changed` alters
 * art-5::cl-1 (a second source version). Rows are namespaced by `runTag`.
 */
export function legalSourceFactory(prisma: LegalSourcePrisma, runTag: string) {
  let counter = 0;
  return async function createLegalSource(
    changed = false,
    status: "ACTIVE" | "SUPERSEDED" | "DRAFT" = "ACTIVE",
  ) {
    counter += 1;
    const tag = `${runTag}-${counter}`;
    const legalSource = await prisma.legalSourceVersion.create({
      data: { version: `legalSource-${tag}`, status, sourceManifest: {} },
    });
    const document = await prisma.legalSourceDocument.create({
      data: {
        legalSourceVersionId: legalSource.id,
        documentId: FIXTURE_DOCUMENT_ID,
        title: "Synthetic notice",
        sourceUrl: "https://example.invalid/notice",
        sourceSha256: "a".repeat(64),
        sourceEffectStatus: "IN_FORCE",
      },
    });
    await prisma.legalDocumentChunk.createMany({
      data: FIXTURE_LOCATORS.map((locator) => ({
        id: `${tag}-${locator}`,
        legalSourceVersionId: legalSource.id,
        legalSourceDocumentId: document.id,
        documentId: FIXTURE_DOCUMENT_ID,
        locator,
        content: `content ${locator}`,
        contentSha256: fixtureHash(
          locator,
          changed && locator === "art-5::cl-1" ? "v2" : "v1",
        ),
        hierarchy: {},
        legalStatus: "ACTIVE",
        legalEffectStatus: "EFFECTIVE",
        legalStatusSourceRef: "source-metadata:fixture",
      })),
    });
    await prisma.legalRetrievalIndex.create({
      data: {
        legalSourceVersionId: legalSource.id,
        version: `index-${tag}`,
        status: "VALID",
        configHash: "c".repeat(64),
        contentHash: "d".repeat(64),
        validationManifestRef: `manifest:${tag}`,
        validatedAt: new Date(),
      },
    });
    return legalSource;
  };
}
