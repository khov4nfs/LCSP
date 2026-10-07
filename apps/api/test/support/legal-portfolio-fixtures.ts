import {
  LEGAL_CONTEXT_RELATION_KINDS,
  LEGAL_PORTFOLIO_COVERAGE_STATES,
  type LegalPortfolioPacket,
  type LegalPortfolioSourceRef,
} from "@lcsp/contracts/legal-portfolio";

import type {
  CorpusChunkSnapshot,
  CorpusSnapshot,
} from "../../src/modules/legal-portfolio/application/services/legal-portfolio-integrity.validator.js";

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
  overrides: Partial<Record<string, Partial<CorpusChunkSnapshot>>> = {},
): CorpusChunkSnapshot[] {
  return FIXTURE_LOCATORS.map((locator) => ({
    id: `${variant}-${locator}`,
    documentId: FIXTURE_DOCUMENT_ID,
    locator,
    contentSha256: fixtureHash(
      locator,
      variant === "v2" && locator === "art-5::cl-1" ? "v2" : "v1",
    ),
    legalStatus: "IN_FORCE",
    sourceEffectStatus: "IN_FORCE",
    ...overrides[locator],
  }));
}

export function fixtureCorpus(
  overrides: Partial<CorpusSnapshot> = {},
  chunkOverrides: Partial<Record<string, Partial<CorpusChunkSnapshot>>> = {},
): CorpusSnapshot {
  return {
    corpusVersionId: "corpus-v1",
    retrievalIndexValid: true,
    chunks: fixtureChunks("v1", chunkOverrides),
    ...overrides,
  };
}

export function ref(locator: string, variant = "v1"): LegalPortfolioSourceRef {
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

function legalRule(
  legalRuleId: string,
  locators: readonly string[],
  coverage: "covered" | "nonAssessable" = "covered",
  nonRepositoryDuty = false,
) {
  return {
    legalRuleId,
    title: `Rule ${legalRuleId}`,
    proposition: `Proposition for ${legalRuleId}.`,
    applicabilityConditions: [],
    qualifiers: [],
    exceptions: [],
    nonRepositoryDuty,
    sourceRefs: locators.map((locator) => ref(locator)),
    coverage:
      coverage === "covered"
        ? {
            state: LEGAL_PORTFOLIO_COVERAGE_STATES.COVERED_BY_ENGINEERING_RULES,
            nonAssessableReason: null,
          }
        : {
            state: LEGAL_PORTFOLIO_COVERAGE_STATES.NON_ASSESSABLE,
            nonAssessableReason:
              "Duty cannot be established from a repository.",
          },
  };
}

function engineeringRule(
  engineeringRuleId: string,
  legalRuleIds: string[],
  locators: readonly string[],
) {
  return {
    engineeringRuleId,
    legalRuleIds,
    concept: `Concept ${engineeringRuleId}`,
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
export function validPacket(): LegalPortfolioPacket {
  return {
    legalRules: [
      legalRule("LR-DEF", ["art-1::cl-1"]),
      legalRule("LR-RET", ["art-5::cl-1::pt-a", "art-5::cl-1::pt-b"]),
      legalRule("LR-EXC", ["art-3::cl-1"]),
      legalRule("LR-XREF", ["art-4::cl-1::pt-a", "art-2::cl-1"]),
      legalRule("LR-PERSON", ["art-6::cl-1"], "nonAssessable", true),
    ],
    engineeringRules: [
      engineeringRule("ER-DEF", ["LR-DEF"], ["art-1::cl-1"]),
      engineeringRule(
        "ER-RET",
        ["LR-RET", "LR-EXC"],
        ["art-5::cl-1::pt-a", "art-3::cl-1"],
      ),
      engineeringRule("ER-XREF", ["LR-XREF"], ["art-4::cl-1::pt-a"]),
    ],
    contextRelations: [
      {
        relationId: "REL-EXC",
        kind: LEGAL_CONTEXT_RELATION_KINDS.EXCEPTION,
        fromLegalRuleId: "LR-RET",
        toLegalRuleId: "LR-EXC",
        toSourceRef: null,
      },
      {
        relationId: "REL-DEF",
        kind: LEGAL_CONTEXT_RELATION_KINDS.DEFINITION,
        fromLegalRuleId: "LR-XREF",
        toLegalRuleId: null,
        toSourceRef: ref("art-1::cl-1"),
      },
    ],
  };
}

export const FIXTURE_LEAVES = LEAVES;
