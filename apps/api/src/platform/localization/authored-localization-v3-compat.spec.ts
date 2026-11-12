import { describe, expect, it } from "@jest/globals";
import { createHash } from "node:crypto";
import {
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_BASIS_FINDINGS,
  RULE_DECISION_BASIS_KINDS,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
  RULE_DECISION_CRITERION_OUTCOMES,
  RULE_DECISION_REFERENCE_TYPES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_ARTIFACT_KINDS,
  ASSESSMENT_DECISION_SCOPE,
  ASSESSMENT_EVIDENCE_TYPES,
  ASSESSMENT_FACT_AUTHORITIES,
  ASSESSMENT_FACT_KINDS,
  ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION,
} from "@lcsp/contracts/assessment-domain";
import {
  ASSESSMENT_REPORT_ACTION_PRIORITIES,
  ASSESSMENT_REPORT_REFERENCE_ORIGINS,
  ASSESSMENT_REPORT_SOURCE_SCOPE_MODES,
  ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES,
  ASSESSMENT_REPORT_V3_LIMITS,
  assessmentFinalReportV3Schema,
  type AssessmentFinalReportV3,
} from "@lcsp/contracts/assessment-report";
import { LEGAL_REQUIREMENT_COVERAGE_STATES } from "@lcsp/contracts/compliance-rule-set";
import { authoredFields } from "./authored-localization.service.js";
import { authoredLocalizationFixture } from "../../../test/support/authored-localization.fixture.js";

const COMMIT = "a".repeat(40);
const sha = (ch: string) => `sha256:${ch.repeat(64).slice(0, 64)}`;
const LEGAL_SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const RULE_SET_ID = "22222222-2222-4222-8222-222222222222";
const SNAPSHOT_ID = "33333333-3333-4333-8333-333333333333";
const SCAN_JOB_ID = "44444444-4444-4444-8444-444444444444";
const ARTIFACT_ID = "55555555-5555-4555-8555-555555555555";
const ASSESSMENT_ID = "66666666-6666-4666-8666-666666666666";
const DECISION_ID = "77777777-7777-4777-8777-777777777771";
const FACT_HUMAN_ID = "88888888-8888-4888-8888-888888888881";
const EVIDENCE_HUMAN_ID = "99999999-9999-4999-8999-999999999991";
const EVIDENCE_REPO_ID = "99999999-9999-4999-8999-999999999992";

function createV3LocalizationFixture(): AssessmentFinalReportV3 {
  const basisRef = {
    type: RULE_DECISION_REFERENCE_TYPES.CONFIRMED_FACT,
    factId: FACT_HUMAN_ID,
    caseRevision: 1,
  } as const;
  const criterionRef = {
    type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
    evidenceId: EVIDENCE_REPO_ID,
  } as const;
  return assessmentFinalReportV3Schema.parse({
    schemaVersion: ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION,
    artifactId: ARTIFACT_ID,
    assessmentId: ASSESSMENT_ID,
    kind: ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT,
    identity: { repositorySnapshotId: SNAPSHOT_ID, repositoryCommit: COMMIT },
    pins: {
      legalSourceVersionId: LEGAL_SOURCE_ID,
      legalSourceVersion: "LAW-2026",
      ruleSetVersionId: RULE_SET_ID,
      ruleSetVersion: "RULES-2026",
      ruleSetDigest: "b".repeat(64),
      repositorySnapshotId: SNAPSHOT_ID,
      repositoryScanJobId: SCAN_JOB_ID,
      repositoryCommit: COMMIT,
    },
    caseRevision: 1,
    decisionFingerprint: sha("c"),
    sourceScope: {
      mode: ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.SUBTREE,
      visibility: ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_FULL,
      sourcePathPrefix: "apps/api",
      excludedPaths: [],
      limitationReasons: [],
      searchCoverageEvidenceIds: [],
    },
    legalRequirements: [
      {
        legalRequirementId: "req-1",
        title: "Requirement title",
        proposition: "Requirement proposition",
        applicabilityConditions: ["Condition text"],
        qualifiers: ["Qualifier text"],
        exceptions: ["Exception text"],
        nonRepositoryDuty: false,
        coverageState:
          LEGAL_REQUIREMENT_COVERAGE_STATES.COVERED_BY_ASSESSMENT_RULES,
        sourceRefs: [
          {
            legalSourceVersionId: LEGAL_SOURCE_ID,
            legalSourceVersion: "LAW-2026",
            documentId: "law-doc-1",
            documentTitle: "Law Document Title",
            locator: "art-1",
            contentSha256: sha("a"),
          },
        ],
      },
    ],
    ruleDetails: [
      {
        assessmentRuleId: "rule-1",
        assessmentRuleVersion: "1",
        legalRequirementIds: ["req-1"],
        concept: "Rule concept",
        legalIntent: "Rule legal intent",
        applicabilityGuidance: "Rule applicability guidance",
        criteria: [{ criterionId: "crit-1", statement: "Criterion statement" }],
        decisionId: DECISION_ID,
        decisionRevision: 1,
        decision: {
          assessmentRuleId: "rule-1",
          assessmentRuleVersion: "1",
          scopeId: ASSESSMENT_DECISION_SCOPE,
          ruleSetVersionId: RULE_SET_ID,
          repositorySnapshotId: SNAPSHOT_ID,
          repositoryCommit: COMMIT,
          caseRevision: 1,
          legalContextRefs: [{ legalContextId: "req-1" }],
          applicability: RULE_DECISION_APPLICABILITIES.APPLICABLE,
          rationale: "Decision rationale",
          references: [criterionRef],
          applicabilityBasis: [
            {
              legalRequirementId: "req-1",
              kind: RULE_DECISION_BASIS_KINDS.APPLICABILITY_CONDITION,
              index: 0,
              finding: RULE_DECISION_BASIS_FINDINGS.ESTABLISHED,
              rationale: "Basis rationale",
              references: [basisRef],
            },
          ],
          criteria: [
            {
              criterionId: "crit-1",
              outcome: RULE_DECISION_CRITERION_OUTCOMES.MET,
              rationale: "Decision criterion rationale",
              references: [criterionRef],
            },
          ],
          compliance: RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT,
        },
        decisionReferences: [
          {
            origin: ASSESSMENT_REPORT_REFERENCE_ORIGINS.decision,
            reference: criterionRef,
          },
        ],
        applicabilityBasisReferences: [
          {
            origin: ASSESSMENT_REPORT_REFERENCE_ORIGINS.applicabilityBasis,
            legalRequirementId: "req-1",
            kind: RULE_DECISION_BASIS_KINDS.APPLICABILITY_CONDITION,
            index: 0,
            reference: basisRef,
          },
        ],
        factEvidenceReferences: [
          {
            origin: ASSESSMENT_REPORT_REFERENCE_ORIGINS.factEvidence,
            factId: FACT_HUMAN_ID,
            reference: {
              type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
              evidenceId: EVIDENCE_HUMAN_ID,
            },
          },
        ],
        criteriaDecisions: [
          {
            criterionId: "crit-1",
            statement: "Criterion statement",
            outcome: RULE_DECISION_CRITERION_OUTCOMES.MET,
            rationale: "Projected criterion rationale",
            references: [
              {
                origin: ASSESSMENT_REPORT_REFERENCE_ORIGINS.criterion,
                reference: criterionRef,
              },
            ],
          },
        ],
        narrative: {
          summary: "Rule narrative summary",
          recommendations: ["Rule recommendation 1"],
        },
        factIds: [FACT_HUMAN_ID],
        evidenceIds: [EVIDENCE_HUMAN_ID, EVIDENCE_REPO_ID],
        sourceRefs: [
          {
            legalSourceVersionId: LEGAL_SOURCE_ID,
            legalSourceVersion: "LAW-2026",
            documentId: "law-doc-1",
            documentTitle: "Law Document Title",
            locator: "art-1",
            contentSha256: sha("a"),
          },
        ],
      },
    ],
    factIndex: [
      {
        factId: FACT_HUMAN_ID,
        caseRevision: 1,
        kind: ASSESSMENT_FACT_KINDS.FACT,
        authority: ASSESSMENT_FACT_AUTHORITIES.HUMAN_PROVIDED,
        statement: "Customer answer statement",
        evidenceIds: [EVIDENCE_HUMAN_ID],
      },
    ],
    evidenceIndex: [
      {
        evidenceId: EVIDENCE_HUMAN_ID,
        type: ASSESSMENT_EVIDENCE_TYPES.HUMAN_ANSWER,
        contentSha256: sha("d"),
        repositoryCommit: null,
        safeLocator: null,
      },
      {
        evidenceId: EVIDENCE_REPO_ID,
        type: ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE,
        contentSha256: sha("e"),
        repositoryCommit: COMMIT,
        safeLocator: "apps/api/src/index.ts:1-20",
      },
    ],
    outcomeSummary: {
      totalRules: 1,
      applicableCompliant: 1,
      applicableNonCompliant: 0,
      notApplicable: 0,
    },
    boundedNarrative: {
      summary: "Overall report summary",
      scopeLimitations: ["Scope limitation narrative"],
    },
    boundedActionPlan: {
      maxHighlightItems: ASSESSMENT_REPORT_V3_LIMITS.MAX_ACTION_PLAN_HIGHLIGHTS,
      totalRecommendations: 1,
      omittedCount: 0,
      truncated: false,
      items: [
        {
          actionId: "rule-1#0",
          assessmentRuleId: "rule-1",
          ruleDetailRef: "/ruleDetails/0",
          recommendationIndex: 0,
          priority: ASSESSMENT_REPORT_ACTION_PRIORITIES.LOW,
          summary: "Rule recommendation 1",
        },
      ],
    },
    publicationProvenance: { sourceManifestDigest: null, publishedAt: null },
  });
}

describe("Report V3 compatibility with B1 authoredFields localization extractor", () => {
  it("extracts every V3 narrative leaf and excludes all canonical enums, IDs, paths, hashes, references, facts, and answers", () => {
    const report = createV3LocalizationFixture();
    const fields = authoredFields(report);
    const paths = new Set(fields.map((f) => f.path));

    const expectedNarrativePaths = [
      "/legalRequirements/0/title",
      "/legalRequirements/0/proposition",
      "/legalRequirements/0/applicabilityConditions/0",
      "/legalRequirements/0/qualifiers/0",
      "/legalRequirements/0/exceptions/0",
      "/ruleDetails/0/concept",
      "/ruleDetails/0/legalIntent",
      "/ruleDetails/0/applicabilityGuidance",
      "/ruleDetails/0/criteria/0/statement",
      "/ruleDetails/0/decision/rationale",
      "/ruleDetails/0/decision/applicabilityBasis/0/rationale",
      "/ruleDetails/0/criteria/0/rationale",
      "/ruleDetails/0/criteriaDecisions/0/statement",
      "/ruleDetails/0/criteriaDecisions/0/rationale",
      "/ruleDetails/0/narrative/summary",
      "/ruleDetails/0/narrative/recommendations/0",
      "/boundedNarrative/summary",
      "/boundedNarrative/scopeLimitations/0",
      "/boundedActionPlan/items/0/summary",
    ];
    // Note: /ruleDetails/0/decision/criteria/0/rationale is the actual path for decision criterion rationale
    const normalizedExpected = expectedNarrativePaths.map((p) =>
      p === "/ruleDetails/0/criteria/0/rationale"
        ? "/ruleDetails/0/decision/criteria/0/rationale"
        : p,
    );

    expect([...paths].sort()).toEqual([...normalizedExpected].sort());

    const forbiddenValues = [
      "ASSESSMENT_FINAL_REPORT_V3",
      "SUBTREE",
      "KNOWN_FULL",
      "apps/api",
      "apps/api/src/index.ts:1-20",
      "rule-1",
      "rule-1#0",
      "/ruleDetails/0",
      "LOW",
      "MET",
      "APPLICABLE",
      "COMPLIANT",
      "Customer answer statement",
      "Law Document Title",
    ];
    for (const field of fields) {
      expect(forbiddenValues).not.toContain(field.text);
    }
  });

  it("handles nested arrays and JSON-pointer escaping (~, /, $) and produces a schema-valid localized V3 report", async () => {
    const report = createV3LocalizationFixture();
    const raw = JSON.stringify(report);
    const sourceSha = createHash("sha256").update(raw).digest("hex");

    const translations: Record<string, string> = {};
    for (const field of authoredFields(report)) {
      translations[field.text] = `[VI] ${field.text}`;
    }
    const fixture = authoredLocalizationFixture(translations);
    const localized = await fixture.service.localizedReportDocument(
      ASSESSMENT_ID,
      ARTIFACT_ID,
      sourceSha,
      report,
      "vi",
    );
    const parsedLocalized = assessmentFinalReportV3Schema.parse(localized);
    expect(parsedLocalized.boundedNarrative.summary).toBe(
      "[VI] Overall report summary",
    );
    expect(parsedLocalized.boundedActionPlan.items[0].summary).toBe(
      "[VI] Rule recommendation 1",
    );
    expect(parsedLocalized.sourceScope.sourcePathPrefix).toBe("apps/api");
    expect(parsedLocalized.factIndex[0].statement).toBe(
      "Customer answer statement",
    );

    // JSON-pointer escaping for ~, /, and $ keys in nested objects/arrays
    const nestedSpecial = {
      nested: [
        {
          "a/b~c$d": {
            summary: "Escaped pointer narrative",
            priority: "HIGH",
          },
        },
      ],
    };
    const escapedFields = authoredFields(nestedSpecial);
    expect(escapedFields).toEqual([
      {
        path: "/nested/0/a~1b~0c$d/summary",
        text: "Escaped pointer narrative",
      },
    ]);
  });
});
