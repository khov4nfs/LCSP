import assert from "node:assert/strict";
import test from "node:test";

import {
  assessmentFinalReportArtifactVersionedSchema,
  assessmentFinalReportV2Schema,
  ASSESSMENT_REPORT_REFERENCE_ORIGINS,
  buildAssessmentReportPresentation,
  type AssessmentFinalReportV2,
} from "@lcsp/contracts/assessment-report";
import {
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_ARTIFACT_KINDS,
  ASSESSMENT_FINAL_REPORT_V2_SCHEMA_VERSION,
} from "@lcsp/contracts/assessment-domain";

const uuid = () => "11111111-1111-4111-8111-111111111111";
const LEGAL_SOURCE_ID = uuid();
const RULE_SET_ID = uuid();
const SNAPSHOT_ID = uuid();
const SCAN_JOB_ID = uuid();
const FACT_ID = uuid();
const EVIDENCE_ID = uuid();
const sha = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const source = (documentId: string) => ({
  legalSourceVersionId: LEGAL_SOURCE_ID,
  legalSourceVersion: "LAW-2026",
  documentId,
  locator: "article-1",
  contentSha256: sha("a"),
});

const reference = () => ({
  origin: ASSESSMENT_REPORT_REFERENCE_ORIGINS.decision,
  reference: {
    type: "CONFIRMED_FACT" as const,
    factId: FACT_ID,
    caseRevision: 1,
  },
});

const decision = (applicability: "APPLICABLE" | "NOT_APPLICABLE") =>
  applicability === RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE
    ? {
        assessmentRuleId: "rule-1",
        assessmentRuleVersion: "1",
        scopeId: "ASSESSMENT",
        ruleSetVersionId: RULE_SET_ID,
        repositorySnapshotId: SNAPSHOT_ID,
        repositoryCommit: "a".repeat(40),
        caseRevision: 1,
        legalContextRefs: [{ legalContextId: "req-1" }],
        applicability: RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE,
        rationale: "The corpus condition is not present.",
        references: [
          { type: "CONFIRMED_FACT" as const, factId: FACT_ID, caseRevision: 1 },
        ],
        criteria: [],
        compliance: null,
      }
    : {
        assessmentRuleId: "rule-1",
        assessmentRuleVersion: "1",
        scopeId: "ASSESSMENT",
        ruleSetVersionId: RULE_SET_ID,
        repositorySnapshotId: SNAPSHOT_ID,
        repositoryCommit: "a".repeat(40),
        caseRevision: 1,
        legalContextRefs: [{ legalContextId: "req-1" }],
        applicability: RULE_DECISION_APPLICABILITIES.APPLICABLE,
        rationale: "The corpus condition applies.",
        references: [
          { type: "CONFIRMED_FACT" as const, factId: FACT_ID, caseRevision: 1 },
        ],
        criteria: [
          {
            criterionId: "criterion-1",
            outcome: "MET" as const,
            rationale: "The accepted fact satisfies the criterion.",
            references: [
              {
                type: "CONFIRMED_FACT" as const,
                factId: FACT_ID,
                caseRevision: 1,
              },
            ],
          },
        ],
        compliance: RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT,
      };

function report(
  applicability: "APPLICABLE" | "NOT_APPLICABLE" = "APPLICABLE",
): AssessmentFinalReportV2 {
  const acceptedDecision = decision(applicability);
  const evidenceId = EVIDENCE_ID;
  const factId = FACT_ID;
  const ruleDecision = {
    ...acceptedDecision,
    references: [{ type: "CONFIRMED_FACT" as const, factId, caseRevision: 1 }],
    ...(acceptedDecision.criteria.length
      ? {
          criteria: [
            {
              ...acceptedDecision.criteria[0],
              references: [
                { type: "CONFIRMED_FACT" as const, factId, caseRevision: 1 },
              ],
            },
          ],
        }
      : {}),
  };
  return {
    schemaVersion: ASSESSMENT_FINAL_REPORT_V2_SCHEMA_VERSION,
    artifactId: uuid(),
    assessmentId: uuid(),
    kind: ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT,
    identity: {
      repositorySnapshotId: SNAPSHOT_ID,
      repositoryCommit: "a".repeat(40),
    },
    pins: {
      legalSourceVersionId: LEGAL_SOURCE_ID,
      legalSourceVersion: "LAW-2026",
      ruleSetVersionId: RULE_SET_ID,
      ruleSetVersion: "RULES-2026",
      ruleSetDigest: "b".repeat(64),
      repositorySnapshotId: SNAPSHOT_ID,
      repositoryScanJobId: SCAN_JOB_ID,
      repositoryCommit: "a".repeat(40),
    },
    caseRevision: 1,
    decisionFingerprint: sha("c"),
    legalRequirements: [
      {
        legalRequirementId: "req-1",
        title: "Requirement",
        proposition: "A corpus-derived requirement.",
        applicabilityConditions: ["Condition"],
        qualifiers: [],
        exceptions: [],
        nonRepositoryDuty: false,
        coverageState: "COVERED_BY_ASSESSMENT_RULES",
        sourceRefs: [source("law-1")],
      },
    ],
    ruleDetails: [
      {
        assessmentRuleId: "rule-1",
        assessmentRuleVersion: "1",
        legalRequirementIds: ["req-1"],
        concept: "Corpus rule",
        legalIntent: "Assess the requirement.",
        applicabilityGuidance: "Use the accepted decision.",
        criteria: [{ criterionId: "criterion-1", statement: "Criterion" }],
        decisionId: uuid(),
        decisionRevision: 1,
        decision: ruleDecision,
        decisionReferences: [reference()],
        criteriaDecisions:
          applicability === "APPLICABLE"
            ? [
                {
                  criterionId: "criterion-1",
                  statement: "Criterion",
                  outcome: "MET",
                  rationale: "Accepted.",
                  references: [
                    {
                      ...reference(),
                      origin: ASSESSMENT_REPORT_REFERENCE_ORIGINS.criterion,
                    },
                  ],
                },
              ]
            : [],
        narrative: { summary: "Bounded summary.", recommendations: [] },
        factIds: [factId],
        evidenceIds: [evidenceId],
        sourceRefs: [source("law-1")],
      },
    ],
    factIndex: [
      {
        factId,
        caseRevision: 1,
        kind: "FACT",
        authority: "HUMAN_PROVIDED",
        statement: "Accepted fact.",
        evidenceIds: [evidenceId],
      },
    ],
    evidenceIndex: [
      {
        evidenceId,
        type: "HUMAN_ANSWER",
        contentSha256: sha("d"),
        repositoryCommit: null,
        safeLocator: null,
      },
    ],
    outcomeSummary:
      applicability === "APPLICABLE"
        ? {
            totalRules: 1,
            applicableCompliant: 1,
            applicableNonCompliant: 0,
            notApplicable: 0,
          }
        : {
            totalRules: 1,
            applicableCompliant: 0,
            applicableNonCompliant: 0,
            notApplicable: 1,
          },
    boundedNarrative: {
      summary: "Assessment summary.",
      actionPlan: [],
      scopeLimitations: [],
    },
    publicationProvenance: { sourceManifestDigest: null, publishedAt: null },
  } as AssessmentFinalReportV2;
}

test("accepts applicable V2 report and preserves separate reference locations", () => {
  const parsed = assessmentFinalReportV2Schema.parse(report());
  assert.equal(parsed.ruleDetails[0].decision.applicability, "APPLICABLE");
  assert.equal(parsed.ruleDetails[0].criteriaDecisions.length, 1);
});

test("accepts NOT_APPLICABLE with decision references and no criteria", () => {
  const parsed = assessmentFinalReportV2Schema.parse(report("NOT_APPLICABLE"));
  assert.equal(parsed.ruleDetails[0].decision.compliance, null);
  assert.deepEqual(parsed.ruleDetails[0].decision.criteria, []);
  assert.deepEqual(parsed.ruleDetails[0].criteriaDecisions, []);
});

test("accepts an applicable non-compliant decision without turning it into a global classification", () => {
  const invalid = report();
  invalid.ruleDetails[0].decision.criteria[0].outcome = "NOT_MET";
  invalid.ruleDetails[0].decision.compliance = "NON_COMPLIANT";
  invalid.ruleDetails[0].criteriaDecisions[0].outcome = "NOT_MET";
  invalid.outcomeSummary = {
    totalRules: 1,
    applicableCompliant: 0,
    applicableNonCompliant: 1,
    notApplicable: 0,
  };
  const parsed = assessmentFinalReportV2Schema.parse(invalid);
  assert.equal(parsed.ruleDetails[0].decision.compliance, "NON_COMPLIANT");
});

test("supports multiple LegalRequirements linked to one rule and shared evidence indexes", () => {
  const value = report();
  value.legalRequirements.push({
    ...value.legalRequirements[0],
    legalRequirementId: "req-2",
  });
  value.ruleDetails[0].legalRequirementIds.push("req-2");
  const parsed = assessmentFinalReportV2Schema.parse(value);
  assert.deepEqual(parsed.ruleDetails[0].legalRequirementIds, [
    "req-1",
    "req-2",
  ]);
  assert.equal(parsed.evidenceIndex.length, 1);
});

test("supports mixed deterministic outcomes without adding an insufficient-information decision", () => {
  const value = report();
  const second = structuredClone(value.ruleDetails[0]);
  second.assessmentRuleId = "rule-2";
  second.decision.assessmentRuleId = "rule-2";
  second.decisionId = "22222222-2222-4222-8222-222222222222";
  value.ruleDetails.push(second);
  value.outcomeSummary = {
    totalRules: 2,
    applicableCompliant: 2,
    applicableNonCompliant: 0,
    notApplicable: 0,
  };
  const parsed = assessmentFinalReportV2Schema.parse(value);
  assert.equal(parsed.outcomeSummary.totalRules, 2);
});

test("rejects outcome counts that imply compliance for an all-N/A report", () => {
  const invalid = report("NOT_APPLICABLE");
  invalid.outcomeSummary.applicableCompliant = 1;
  assert.throws(() => assessmentFinalReportV2Schema.parse(invalid));
});

test("rejects unknown fact index references rather than assigning references by condition", () => {
  const invalid = report();
  invalid.ruleDetails[0].factIds = [uuid().replace(/.$/u, "2")];
  assert.throws(() => assessmentFinalReportV2Schema.parse(invalid));
});

test("rejects an unknown evidence index reference", () => {
  const invalid = report();
  invalid.ruleDetails[0].evidenceIds = ["22222222-2222-4222-8222-222222222222"];
  assert.throws(() => assessmentFinalReportV2Schema.parse(invalid));
});

test("rejects missing legal source locator or malformed source hash", () => {
  const missingLocator = report();
  missingLocator.ruleDetails[0].sourceRefs[0].locator = "";
  assert.throws(() => assessmentFinalReportV2Schema.parse(missingLocator));

  const malformedHash = report();
  malformedHash.legalRequirements[0].sourceRefs[0].contentSha256 = "bad";
  assert.throws(() => assessmentFinalReportV2Schema.parse(malformedHash));
});

test("rejects duplicate rule details", () => {
  const invalid = report();
  invalid.ruleDetails.push(structuredClone(invalid.ruleDetails[0]));
  invalid.outcomeSummary.totalRules = 2;
  invalid.outcomeSummary.applicableCompliant = 2;
  assert.throws(() => assessmentFinalReportV2Schema.parse(invalid));
});

test("accepts corpus-neutral non-AI terminology without a hard-coded report taxonomy", () => {
  const value = report();
  value.legalRequirements[0].title = "Data retention duty";
  value.ruleDetails[0].concept = "Retention control";
  const parsed = assessmentFinalReportV2Schema.parse(value);
  assert.equal(parsed.ruleDetails[0].concept, "Retention control");
});

test("versioned schema accepts V1 without converting it to V2", () => {
  const value = report();
  const v1 = {
    schemaVersion: "ASSESSMENT_FINAL_REPORT_V1" as const,
    artifactId: value.artifactId,
    assessmentId: value.assessmentId,
    kind: value.kind,
    pins: {
      ruleSetVersionId: value.pins.ruleSetVersionId,
      repositorySnapshotId: value.pins.repositorySnapshotId,
      repositoryScanJobId: value.pins.repositoryScanJobId,
      repositoryCommit: value.pins.repositoryCommit,
    },
    caseRevision: value.caseRevision,
    decisionFingerprint: value.decisionFingerprint,
    summary: value.boundedNarrative.summary,
    findings: value.ruleDetails.map((rule) => ({
      assessmentRuleId: rule.assessmentRuleId,
      decisionId: rule.decisionId,
      decisionRevision: rule.decisionRevision,
      decision: rule.decision,
      summary: rule.narrative.summary,
      recommendations: rule.narrative.recommendations,
    })),
    provenance: {
      evidenceIds: value.evidenceIndex.map((evidence) => evidence.evidenceId),
      factIds: value.factIndex.map((fact) => fact.factId),
      searchCoverageEvidenceIds: [],
    },
  };
  assert.equal(
    assessmentFinalReportArtifactVersionedSchema.parse(v1).schemaVersion,
    "ASSESSMENT_FINAL_REPORT_V1",
  );
  assert.equal(
    assessmentFinalReportV2Schema.shape.schemaVersion.value,
    ASSESSMENT_FINAL_REPORT_V2_SCHEMA_VERSION,
  );
});

test("rejects an unknown report schema version explicitly", () => {
  const unknown = { ...report(), schemaVersion: "ASSESSMENT_FINAL_REPORT_V3" };
  assert.equal(
    assessmentFinalReportArtifactVersionedSchema.safeParse(unknown).success,
    false,
  );
});

test("builds a deterministic six-section V2 presentation without changing the artifact", () => {
  const value = report();
  const before = structuredClone(value);
  const first = buildAssessmentReportPresentation(value);
  const second = buildAssessmentReportPresentation(value);
  assert.deepEqual(first, second);
  assert.deepEqual(value, before);
  assert.deepEqual(
    first.sections.map((section) => section.order),
    [1, 2, 3, 4, 5, 6],
  );
  assert.equal(first.version, "ASSESSMENT_FINAL_REPORT_V2");
  if ("summary" in first) {
    assert.equal(first.summary.notApplicable, 0);
    assert.equal(first.obligationDetails.length, value.ruleDetails.length);
    assert.equal(first.obligationDetails[0].compliance, "COMPLIANT");
  }
});

test("keeps historical V1 in an honest compatibility projection", () => {
  const value = report();
  const v1 = {
    schemaVersion: "ASSESSMENT_FINAL_REPORT_V1" as const,
    artifactId: value.artifactId,
    assessmentId: value.assessmentId,
    kind: value.kind,
    pins: {
      ruleSetVersionId: value.pins.ruleSetVersionId,
      repositorySnapshotId: value.pins.repositorySnapshotId,
      repositoryScanJobId: value.pins.repositoryScanJobId,
      repositoryCommit: value.pins.repositoryCommit,
    },
    caseRevision: value.caseRevision,
    decisionFingerprint: value.decisionFingerprint,
    summary: value.boundedNarrative.summary,
    findings: value.ruleDetails.map((rule) => ({
      assessmentRuleId: rule.assessmentRuleId,
      decisionId: rule.decisionId,
      decisionRevision: rule.decisionRevision,
      decision: rule.decision,
      summary: rule.narrative.summary,
      recommendations: rule.narrative.recommendations,
    })),
    provenance: { evidenceIds: [], factIds: [], searchCoverageEvidenceIds: [] },
  };
  const projected = buildAssessmentReportPresentation(v1);
  assert.ok("legacy" in projected);
  if ("legacy" in projected) assert.equal(projected.legacy.findings.length, 1);
});
