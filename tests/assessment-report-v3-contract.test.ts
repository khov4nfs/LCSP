import assert from "node:assert/strict";
import test from "node:test";

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
  ASSESSMENT_FINAL_REPORT_SCHEMA_VERSION,
  ASSESSMENT_FINAL_REPORT_V2_SCHEMA_VERSION,
  ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION,
  SEARCH_COVERAGE_SCOPE_KINDS,
} from "@lcsp/contracts/assessment-domain";
import {
  ASSESSMENT_FINAL_REPORT_V3_FIELD_PATH_CLASSIFICATIONS,
  ASSESSMENT_REPORT_ACTION_PRIORITIES,
  ASSESSMENT_REPORT_FIELD_CLASSIFICATIONS,
  ASSESSMENT_REPORT_REFERENCE_ORIGINS,
  ASSESSMENT_REPORT_SOURCE_SCOPE_MODES,
  ASSESSMENT_REPORT_SOURCE_VISIBILITY_LIMITATION_REASONS,
  ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES,
  ASSESSMENT_REPORT_V3_LIMITS,
  ASSESSMENT_REPORT_V3_REFERENCE_ORIGINS,
  assessmentFinalReportArtifactVersionedSchema,
  assessmentFinalReportV2Schema,
  assessmentFinalReportV3Schema,
  assessmentReportApplicabilityBasisReferenceSchema,
  assessmentReportDecisionReferenceSchema,
  classifyLegacyAssessmentReportSourceScope,
  measureAssessmentFinalReportV3Size,
  resolveV3BoundedActionPlanItems,
  utf8ByteLength,
  type AssessmentFinalReportV2,
  type AssessmentFinalReportV3,
} from "@lcsp/contracts/assessment-report";
import {
  LEGAL_CONTEXT_RELATION_KINDS,
  LEGAL_REQUIREMENT_COVERAGE_STATES,
} from "@lcsp/contracts/compliance-rule-set";

const LEGAL_SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const RULE_SET_ID = "22222222-2222-4222-8222-222222222222";
const SNAPSHOT_ID = "33333333-3333-4333-8333-333333333333";
const SCAN_JOB_ID = "44444444-4444-4444-8444-444444444444";
const ARTIFACT_ID = "55555555-5555-4555-8555-555555555555";
const ASSESSMENT_ID = "66666666-6666-4666-8666-666666666666";
const DECISION_ID_1 = "77777777-7777-4777-8777-777777777771";
const DECISION_ID_2 = "77777777-7777-4777-8777-777777777772";
const FACT_HUMAN_ID = "88888888-8888-4888-8888-888888888881";
const FACT_REPO_ID = "88888888-8888-4888-8888-888888888882";
const EVIDENCE_HUMAN_ID = "99999999-9999-4999-8999-999999999991";
const EVIDENCE_REPO_ID = "99999999-9999-4999-8999-999999999992";
const EVIDENCE_COVERAGE_ID = "99999999-9999-4999-8999-999999999993";

const COMMIT = "a".repeat(40);
const sha = (ch: string) => `sha256:${ch.repeat(64).slice(0, 64)}`;

const sourceRef = (documentId: string) => ({
  legalSourceVersionId: LEGAL_SOURCE_ID,
  legalSourceVersion: "LAW-2026",
  documentId,
  documentTitle: "Data Protection Decree",
  locator: "art-1",
  contentSha256: sha("a"),
});

function createV3Fixture(
  options: {
    applicability?: "APPLICABLE" | "NOT_APPLICABLE";
    compliance?: "COMPLIANT" | "NON_COMPLIANT";
    recommendationCount?: number;
  } = {},
): AssessmentFinalReportV3 {
  const applicability =
    options.applicability ?? RULE_DECISION_APPLICABILITIES.APPLICABLE;
  const compliance =
    options.compliance ?? RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT;
  const recommendationCount = options.recommendationCount ?? 1;

  const criterionOutcome =
    compliance === RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT
      ? RULE_DECISION_CRITERION_OUTCOMES.NOT_MET
      : RULE_DECISION_CRITERION_OUTCOMES.MET;

  const recommendations = Array.from(
    { length: recommendationCount },
    (_, index) => `Actionable remediation step ${index + 1}.`,
  );

  const basisRef = {
    type: RULE_DECISION_REFERENCE_TYPES.CONFIRMED_FACT,
    factId: FACT_HUMAN_ID,
    caseRevision: 1,
  } as const;
  const criterionRef = {
    type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
    evidenceId: EVIDENCE_REPO_ID,
  } as const;
  const decisionRef = {
    type: RULE_DECISION_REFERENCE_TYPES.CONFIRMED_FACT,
    factId: FACT_REPO_ID,
    caseRevision: 1,
  } as const;

  const decision =
    applicability === RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE
      ? {
          assessmentRuleId: "rule-1",
          assessmentRuleVersion: "1",
          scopeId: ASSESSMENT_DECISION_SCOPE,
          ruleSetVersionId: RULE_SET_ID,
          repositorySnapshotId: SNAPSHOT_ID,
          repositoryCommit: COMMIT,
          caseRevision: 1,
          legalContextRefs: [{ legalContextId: "req-1" }],
          applicability: RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE,
          rationale: "The statutory applicability condition is refuted.",
          references: [decisionRef],
          applicabilityBasis: [
            {
              legalRequirementId: "req-1",
              kind: RULE_DECISION_BASIS_KINDS.APPLICABILITY_CONDITION,
              index: 0,
              finding: RULE_DECISION_BASIS_FINDINGS.REFUTED,
              rationale: "Customer confirmation refutes the condition.",
              references: [basisRef],
            },
          ],
          criteria: [],
          compliance: null,
        }
      : {
          assessmentRuleId: "rule-1",
          assessmentRuleVersion: "1",
          scopeId: ASSESSMENT_DECISION_SCOPE,
          ruleSetVersionId: RULE_SET_ID,
          repositorySnapshotId: SNAPSHOT_ID,
          repositoryCommit: COMMIT,
          caseRevision: 1,
          legalContextRefs: [{ legalContextId: "req-1" }],
          applicability: RULE_DECISION_APPLICABILITIES.APPLICABLE,
          rationale: "The statutory applicability condition is established.",
          references: [decisionRef],
          applicabilityBasis: [
            {
              legalRequirementId: "req-1",
              kind: RULE_DECISION_BASIS_KINDS.APPLICABILITY_CONDITION,
              index: 0,
              finding: RULE_DECISION_BASIS_FINDINGS.ESTABLISHED,
              rationale: "Customer confirmation establishes applicability.",
              references: [basisRef],
            },
          ],
          criteria: [
            {
              criterionId: "criterion-1",
              outcome: criterionOutcome,
              rationale: "Repository source check evaluated the control.",
              references: [criterionRef],
            },
          ],
          compliance,
        };

  const includedCount = Math.min(
    recommendationCount,
    ASSESSMENT_REPORT_V3_LIMITS.MAX_ACTION_PLAN_HIGHLIGHTS,
  );

  return {
    schemaVersion: ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION,
    artifactId: ARTIFACT_ID,
    assessmentId: ASSESSMENT_ID,
    kind: ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT,
    identity: {
      repositorySnapshotId: SNAPSHOT_ID,
      repositoryCommit: COMMIT,
    },
    pins: {
      legalSourceVersionId: LEGAL_SOURCE_ID,
      legalSourceVersion: "LAW-2026",
      ruleSetVersionId: RULE_SET_ID,
      ruleSetVersion: "RULES-2026",
      ruleSetDigest: "b".repeat(64),
      repositorySnapshotId: SNAPSHOT_ID,
      repositoryScanJobId: SCAN_JOB_ID,
      repositoryCommit: COMMIT,
      sourcePathPrefix: null,
    },
    caseRevision: 1,
    decisionFingerprint: sha("c"),
    sourceScope: {
      mode: ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.WHOLE_REPOSITORY,
      visibility: ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_FULL,
      sourcePathPrefix: null,
      excludedPaths: [],
      limitationReasons: [],
      searchCoverageEvidenceIds: [EVIDENCE_COVERAGE_ID],
    },
    legalRequirements: [
      {
        legalRequirementId: "req-1",
        title: "Retention control requirement",
        proposition: "The operator must enforce retention controls.",
        applicabilityConditions: ["System stores regulated personal records."],
        qualifiers: ["Applies to active customer databases."],
        exceptions: ["Anonymized aggregate telemetry is excluded."],
        nonRepositoryDuty: false,
        coverageState:
          LEGAL_REQUIREMENT_COVERAGE_STATES.COVERED_BY_ASSESSMENT_RULES,
        sourceRefs: [sourceRef("law-1")],
      },
    ],
    ruleDetails: [
      {
        assessmentRuleId: "rule-1",
        assessmentRuleVersion: "1",
        legalRequirementIds: ["req-1"],
        relatedLegalContexts: [],
        concept: "Data retention control",
        legalIntent: "Ensure bounded retention policies are implemented.",
        applicabilityGuidance: "Evaluate when personal records are stored.",
        criteria: [
          {
            criterionId: "criterion-1",
            statement: "Automated retention purge job is configured.",
          },
        ],
        decisionId: DECISION_ID_1,
        decisionRevision: 1,
        decision,
        decisionReferences: [
          {
            origin: ASSESSMENT_REPORT_V3_REFERENCE_ORIGINS.decision,
            reference: decisionRef,
          },
        ],
        applicabilityBasisReferences: [
          {
            origin: ASSESSMENT_REPORT_V3_REFERENCE_ORIGINS.applicabilityBasis,
            legalRequirementId: "req-1",
            kind: RULE_DECISION_BASIS_KINDS.APPLICABILITY_CONDITION,
            index: 0,
            reference: basisRef,
          },
        ],
        factEvidenceReferences: [
          {
            origin: ASSESSMENT_REPORT_V3_REFERENCE_ORIGINS.factEvidence,
            factId: FACT_HUMAN_ID,
            reference: {
              type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
              evidenceId: EVIDENCE_HUMAN_ID,
            },
          },
          {
            origin: ASSESSMENT_REPORT_V3_REFERENCE_ORIGINS.factEvidence,
            factId: FACT_REPO_ID,
            reference: {
              type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
              evidenceId: EVIDENCE_REPO_ID,
            },
          },
        ],
        criteriaDecisions:
          applicability === RULE_DECISION_APPLICABILITIES.APPLICABLE
            ? [
                {
                  criterionId: "criterion-1",
                  outcome: criterionOutcome,
                  rationale: "Repository source check evaluated the control.",
                  references: [
                    {
                      origin: ASSESSMENT_REPORT_V3_REFERENCE_ORIGINS.criterion,
                      reference: criterionRef,
                    },
                  ],
                },
              ]
            : [],
        narrative: {
          summary: "Bounded rule summary.",
          recommendations,
        },
        factIds: [FACT_HUMAN_ID, FACT_REPO_ID],
        evidenceIds: [EVIDENCE_HUMAN_ID, EVIDENCE_REPO_ID],
        sourceRefs: [sourceRef("law-1")],
      },
    ],
    factIndex: [
      {
        factId: FACT_HUMAN_ID,
        caseRevision: 1,
        kind: ASSESSMENT_FACT_KINDS.FACT,
        authority: ASSESSMENT_FACT_AUTHORITIES.HUMAN_PROVIDED,
        statement: "Customer confirmed system stores personal records.",
        evidenceIds: [EVIDENCE_HUMAN_ID],
      },
      {
        factId: FACT_REPO_ID,
        caseRevision: 1,
        kind: ASSESSMENT_FACT_KINDS.FACT,
        authority: ASSESSMENT_FACT_AUTHORITIES.EVIDENCE_CITED,
        statement: "Repository purge handler deletes expired rows.",
        evidenceIds: [EVIDENCE_REPO_ID],
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
        safeLocator: "apps/api/src/retention/purge.ts:10-42",
      },
      {
        evidenceId: EVIDENCE_COVERAGE_ID,
        type: ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE,
        contentSha256: sha("f"),
        repositoryCommit: COMMIT,
        safeLocator: null,
        searchCoverage: {
          scopes: [
            {
              kind: SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_DIRECTORY,
              path: ".",
            },
          ],
          executedQueriesCount: 1,
          inspectedEntryPointsCount: 1,
          truncatedQueriesCount: 0,
          knownGapsCount: 0,
          directFallbackCount: 0,
          verifiedCompleteness: true,
        },
      },
    ],
    outcomeSummary:
      applicability === RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE
        ? {
            totalRules: 1,
            applicableCompliant: 0,
            applicableNonCompliant: 0,
            notApplicable: 1,
          }
        : compliance === RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT
          ? {
              totalRules: 1,
              applicableCompliant: 0,
              applicableNonCompliant: 1,
              notApplicable: 0,
            }
          : {
              totalRules: 1,
              applicableCompliant: 1,
              applicableNonCompliant: 0,
              notApplicable: 0,
            },
    boundedNarrative: {
      summary: "Overall assessment summary.",
      scopeLimitations: [],
    },
    boundedActionPlan: {
      maxHighlightItems: ASSESSMENT_REPORT_V3_LIMITS.MAX_ACTION_PLAN_HIGHLIGHTS,
      totalRecommendations: recommendationCount,
      omittedCount: recommendationCount - includedCount,
      truncated:
        recommendationCount >
        ASSESSMENT_REPORT_V3_LIMITS.MAX_ACTION_PLAN_HIGHLIGHTS,
      items: recommendations.slice(0, includedCount).map((_summary, index) => ({
        actionId: `rule-1#${index}`,
        assessmentRuleId: "rule-1",
        ruleDetailRef: "/ruleDetails/0",
        recommendationIndex: index,
        priority:
          compliance === RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT
            ? ASSESSMENT_REPORT_ACTION_PRIORITIES.HIGH
            : ASSESSMENT_REPORT_ACTION_PRIORITIES.LOW,
      })),
    },
    publicationProvenance: {
      sourceManifestDigest: null,
      publishedAt: null,
    },
  };
}

function createV2HistoricalFixture(): AssessmentFinalReportV2 {
  const v3 = createV3Fixture();
  const { sourcePathPrefix: _pinnedPrefix, ...v2Pins } = v3.pins;
  return {
    schemaVersion: ASSESSMENT_FINAL_REPORT_V2_SCHEMA_VERSION,
    artifactId: v3.artifactId,
    assessmentId: v3.assessmentId,
    kind: v3.kind,
    identity: v3.identity,
    pins: v2Pins,
    caseRevision: v3.caseRevision,
    decisionFingerprint: v3.decisionFingerprint,
    legalRequirements: v3.legalRequirements,
    ruleDetails: [
      {
        assessmentRuleId: v3.ruleDetails[0].assessmentRuleId,
        assessmentRuleVersion: v3.ruleDetails[0].assessmentRuleVersion,
        legalRequirementIds: v3.ruleDetails[0].legalRequirementIds,
        concept: v3.ruleDetails[0].concept,
        legalIntent: v3.ruleDetails[0].legalIntent,
        applicabilityGuidance: v3.ruleDetails[0].applicabilityGuidance,
        criteria: v3.ruleDetails[0].criteria,
        decisionId: v3.ruleDetails[0].decisionId,
        decisionRevision: v3.ruleDetails[0].decisionRevision,
        decision: v3.ruleDetails[0].decision,
        decisionReferences: v3.ruleDetails[0].decisionReferences,
        criteriaDecisions: v3.ruleDetails[0].criteriaDecisions.map((item) => ({
          ...item,
          statement:
            v3.ruleDetails[0].criteria.find(
              (criterion) => criterion.criterionId === item.criterionId,
            )?.statement ?? item.criterionId,
        })),
        narrative: v3.ruleDetails[0].narrative,
        factIds: v3.ruleDetails[0].factIds,
        evidenceIds: v3.ruleDetails[0].evidenceIds,
        sourceRefs: v3.ruleDetails[0].sourceRefs,
      },
    ],
    factIndex: v3.factIndex,
    evidenceIndex: v3.evidenceIndex.map(
      ({ searchCoverage: _searchCoverage, ...entry }) => entry,
    ),
    outcomeSummary: v3.outcomeSummary,
    boundedNarrative: {
      summary: v3.boundedNarrative.summary,
      actionPlan: v3.ruleDetails[0].narrative.recommendations,
      scopeLimitations: v3.boundedNarrative.scopeLimitations,
    },
    publicationProvenance: v3.publicationProvenance,
  };
}

// ---------------------------------------------------------------------------
// 1. Versioning and compatibility
// ---------------------------------------------------------------------------

test("versioning: V1 and V2 historical fixtures remain valid and production union accepts V1, V2, and V3", () => {
  const v2 = createV2HistoricalFixture();
  const v1 = {
    schemaVersion: ASSESSMENT_FINAL_REPORT_SCHEMA_VERSION,
    artifactId: v2.artifactId,
    assessmentId: v2.assessmentId,
    kind: v2.kind,
    pins: {
      ruleSetVersionId: v2.pins.ruleSetVersionId,
      repositorySnapshotId: v2.pins.repositorySnapshotId,
      repositoryScanJobId: v2.pins.repositoryScanJobId,
      repositoryCommit: v2.pins.repositoryCommit,
    },
    caseRevision: v2.caseRevision,
    decisionFingerprint: v2.decisionFingerprint,
    summary: v2.boundedNarrative.summary,
    findings: v2.ruleDetails.map((rule) => ({
      assessmentRuleId: rule.assessmentRuleId,
      decisionId: rule.decisionId,
      decisionRevision: rule.decisionRevision,
      decision: rule.decision,
      summary: rule.narrative.summary,
      recommendations: rule.narrative.recommendations,
    })),
    provenance: {
      evidenceIds: v2.evidenceIndex.map((e) => e.evidenceId),
      factIds: v2.factIndex.map((f) => f.factId),
      searchCoverageEvidenceIds: [EVIDENCE_COVERAGE_ID],
    },
  };

  assert.equal(
    assessmentFinalReportArtifactVersionedSchema.parse(v1).schemaVersion,
    ASSESSMENT_FINAL_REPORT_SCHEMA_VERSION,
  );
  assert.equal(
    assessmentFinalReportV2Schema.parse(v2).schemaVersion,
    ASSESSMENT_FINAL_REPORT_V2_SCHEMA_VERSION,
  );
  assert.equal(
    assessmentFinalReportArtifactVersionedSchema.parse(v2).schemaVersion,
    ASSESSMENT_FINAL_REPORT_V2_SCHEMA_VERSION,
  );

  const v3 = createV3Fixture();
  assert.equal(
    assessmentFinalReportV3Schema.parse(v3).schemaVersion,
    ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION,
  );
  // C2 invariant: production union now accepts V1, V2, and V3 across reader rollout.
  assert.equal(
    assessmentFinalReportArtifactVersionedSchema.safeParse(v3).success,
    true,
  );
  assert.equal(
    assessmentFinalReportArtifactVersionedSchema.parse(v3).schemaVersion,
    ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION,
  );
});

test("versioning: rejects unknown or V2 discriminator on standalone V3 schema", () => {
  const v3 = createV3Fixture();
  assert.equal(
    assessmentFinalReportV3Schema.safeParse({
      ...v3,
      schemaVersion: "ASSESSMENT_FINAL_REPORT_V99",
    }).success,
    false,
  );
  assert.equal(
    assessmentFinalReportV3Schema.safeParse({
      ...v3,
      schemaVersion: ASSESSMENT_FINAL_REPORT_V2_SCHEMA_VERSION,
    }).success,
    false,
  );
});

// ---------------------------------------------------------------------------
// 2. Canonical decision consistency
// ---------------------------------------------------------------------------

test("canonical consistency: accepts valid COMPLIANT, NON_COMPLIANT, and NOT_APPLICABLE V3 reports", () => {
  const compliant = assessmentFinalReportV3Schema.parse(
    createV3Fixture({
      applicability: RULE_DECISION_APPLICABILITIES.APPLICABLE,
      compliance: RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT,
    }),
  );
  assert.equal(compliant.outcomeSummary.applicableCompliant, 1);

  const nonCompliant = assessmentFinalReportV3Schema.parse(
    createV3Fixture({
      applicability: RULE_DECISION_APPLICABILITIES.APPLICABLE,
      compliance: RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT,
    }),
  );
  assert.equal(nonCompliant.outcomeSummary.applicableNonCompliant, 1);
  assert.equal(
    nonCompliant.ruleDetails[0].criteriaDecisions[0].outcome,
    RULE_DECISION_CRITERION_OUTCOMES.NOT_MET,
  );

  const notApplicable = assessmentFinalReportV3Schema.parse(
    createV3Fixture({
      applicability: RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE,
    }),
  );
  assert.equal(notApplicable.outcomeSummary.notApplicable, 1);
  assert.equal(notApplicable.ruleDetails[0].criteriaDecisions.length, 0);
});

test("canonical consistency: rejects arbitrary or mismatched criterion outcomes", () => {
  const arbitrary = createV3Fixture();
  (arbitrary.ruleDetails[0].criteriaDecisions[0] as { outcome: string }).outcome =
    "ARBITRARY_AUDIT_MARKER";
  assert.equal(assessmentFinalReportV3Schema.safeParse(arbitrary).success, false);

  const mismatched = createV3Fixture({
    compliance: RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT,
  });
  mismatched.ruleDetails[0].criteriaDecisions[0].outcome =
    RULE_DECISION_CRITERION_OUTCOMES.NOT_MET;
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(mismatched).success,
    false,
  );
});

test("canonical consistency: rejects missing, extra, or duplicated criteria", () => {
  const missingProjected = createV3Fixture();
  missingProjected.ruleDetails[0].criteriaDecisions = [];
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(missingProjected).success,
    false,
  );

  const extraProjected = createV3Fixture();
  extraProjected.ruleDetails[0].criteriaDecisions.push({
    ...extraProjected.ruleDetails[0].criteriaDecisions[0],
    criterionId: "criterion-extra",
  });
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(extraProjected).success,
    false,
  );

  const duplicatedProjected = createV3Fixture();
  duplicatedProjected.ruleDetails[0].criteriaDecisions.push(
    structuredClone(duplicatedProjected.ruleDetails[0].criteriaDecisions[0]),
  );
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(duplicatedProjected).success,
    false,
  );

  const missingDecisionCriterion = createV3Fixture();
  missingDecisionCriterion.ruleDetails[0].criteria.push({
    criterionId: "criterion-2",
    statement: "Second required criterion.",
  });
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(missingDecisionCriterion).success,
    false,
  );
});

test("canonical consistency: rejects mismatched decision pins, rule version, and outcome totals", () => {
  const badCommit = createV3Fixture();
  badCommit.ruleDetails[0].decision.repositoryCommit = "f".repeat(40);
  assert.equal(assessmentFinalReportV3Schema.safeParse(badCommit).success, false);

  const badRuleVersion = createV3Fixture();
  badRuleVersion.ruleDetails[0].decision.assessmentRuleVersion = "999";
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(badRuleVersion).success,
    false,
  );

  const badCaseRevision = createV3Fixture();
  badCaseRevision.ruleDetails[0].decision.caseRevision = 2;
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(badCaseRevision).success,
    false,
  );

  const badTotals = createV3Fixture();
  badTotals.outcomeSummary.applicableCompliant = 0;
  badTotals.outcomeSummary.applicableNonCompliant = 1;
  assert.equal(assessmentFinalReportV3Schema.safeParse(badTotals).success, false);
});

test("canonical consistency: accepts valid EN/VI explanations containing legal terms and translated rationale variants", () => {
  const report = createV3Fixture();
  report.ruleDetails[0].decision.rationale =
    "Except where NOT_APPLICABLE under statutory exception, no UNKNOWN gap blocks compliance; ngoại lệ này không làm thay đổi kết quả đã chốt.";
  if (report.ruleDetails[0].decision.applicability === "APPLICABLE") {
    report.ruleDetails[0].decision.criteria[0].rationale =
      "Bản gốc tiếng Anh / English rationale with exception note.";
  }
  report.ruleDetails[0].criteriaDecisions[0].rationale =
    "Giải trình bằng tiếng Việt hợp lệ có nhắc ngoại lệ và trạng thái không áp dụng trong văn cảnh pháp lý.";
  report.ruleDetails[0].narrative.summary =
    "Tóm tắt kết luận tuân thủ có nêu rõ ngoại lệ pháp lý.";
  assert.equal(assessmentFinalReportV3Schema.safeParse(report).success, true);
});

// ---------------------------------------------------------------------------
// 3. References and provenance
// ---------------------------------------------------------------------------

test("references & provenance: enforces applicabilityBasis-only references and rejects silent dropping", () => {
  // Valid case where FACT_HUMAN_ID is referenced ONLY inside applicabilityBasis
  const basisOnly = createV3Fixture();
  assert.equal(assessmentFinalReportV3Schema.safeParse(basisOnly).success, true);

  // Dropping applicabilityBasisReferences must fail
  const missingBasisProjection = createV3Fixture();
  missingBasisProjection.ruleDetails[0].applicabilityBasisReferences = [];
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(missingBasisProjection).success,
    false,
  );

  // Dropping FACT_HUMAN_ID from rule.factIds when it's only in applicabilityBasis must fail
  const missingRuleFactId = createV3Fixture();
  missingRuleFactId.ruleDetails[0].factIds = [FACT_REPO_ID];
  missingRuleFactId.ruleDetails[0].factEvidenceReferences = [
    missingRuleFactId.ruleDetails[0].factEvidenceReferences[1],
  ];
  missingRuleFactId.ruleDetails[0].evidenceIds = [EVIDENCE_REPO_ID];
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(missingRuleFactId).success,
    false,
  );

  // Silent drop of one of two decisionReferences must fail
  const twoDecisionRefs = createV3Fixture();
  twoDecisionRefs.ruleDetails[0].decision.references.push({
    type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
    evidenceId: EVIDENCE_REPO_ID,
  });
  // Without adding to decisionReferences -> rejected
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(twoDecisionRefs).success,
    false,
  );
  // Adding the second reference to decisionReferences -> accepted
  twoDecisionRefs.ruleDetails[0].decisionReferences.push({
    origin: ASSESSMENT_REPORT_V3_REFERENCE_ORIGINS.decision,
    reference: {
      type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
      evidenceId: EVIDENCE_REPO_ID,
    },
  });
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(twoDecisionRefs).success,
    true,
  );
});

test("references & provenance: enforces fact -> evidence transitive closure and rejects unknown/inconsistent pins", () => {
  const missingTransitiveFactEvRef = createV3Fixture();
  missingTransitiveFactEvRef.ruleDetails[0].factEvidenceReferences = [];
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(missingTransitiveFactEvRef).success,
    false,
  );

  const missingTransitiveEvidenceId = createV3Fixture();
  missingTransitiveEvidenceId.ruleDetails[0].evidenceIds = [EVIDENCE_REPO_ID];
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(missingTransitiveEvidenceId)
      .success,
    false,
  );

  const unknownEvidence = createV3Fixture();
  unknownEvidence.evidenceIndex = unknownEvidence.evidenceIndex.filter(
    (e) => e.evidenceId !== EVIDENCE_HUMAN_ID,
  );
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(unknownEvidence).success,
    false,
  );

  const inconsistentSourcePin = createV3Fixture();
  inconsistentSourcePin.ruleDetails[0].sourceRefs[0].legalSourceVersion =
    "LAW-9999";
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(inconsistentSourcePin).success,
    false,
  );
});

test("references & provenance: preserves HUMAN_PROVIDED authority and shared evidence across multiple rules/origins", () => {
  // Attempting to convert HUMAN_PROVIDED fact into EVIDENCE_CITED using HUMAN_ANSWER evidence must fail
  const spoofedAuthority = createV3Fixture();
  spoofedAuthority.factIndex[0].authority =
    ASSESSMENT_FACT_AUTHORITIES.EVIDENCE_CITED;
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(spoofedAuthority).success,
    false,
  );

  // Attempting to give HUMAN_ANSWER evidence a repository safeLocator must fail
  const spoofedLocator = createV3Fixture();
  spoofedLocator.evidenceIndex[0].safeLocator = "src/customer-answer.ts:1-5";
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(spoofedLocator).success,
    false,
  );

  // Multi-rule shared evidence with distinct origins (DECISION, CRITERION, APPLICABILITY_BASIS, FACT_EVIDENCE)
  const shared = createV3Fixture();
  const secondRule = structuredClone(shared.ruleDetails[0]);
  secondRule.assessmentRuleId = "rule-2";
  secondRule.decisionId = DECISION_ID_2;
  secondRule.decision.assessmentRuleId = "rule-2";
  shared.ruleDetails.push(secondRule);
  shared.outcomeSummary.totalRules = 2;
  shared.outcomeSummary.applicableCompliant = 2;
  shared.boundedActionPlan.totalRecommendations = 2;
  shared.boundedActionPlan.items.push({
    actionId: "rule-2#0",
    assessmentRuleId: "rule-2",
    ruleDetailRef: "/ruleDetails/1",
    recommendationIndex: 0,
    priority: ASSESSMENT_REPORT_ACTION_PRIORITIES.LOW,
  });
  const parsed = assessmentFinalReportV3Schema.parse(shared);
  assert.equal(parsed.ruleDetails.length, 2);
  assert.equal(parsed.evidenceIndex.length, 3);
});

// ---------------------------------------------------------------------------
// 4. Source scope
// ---------------------------------------------------------------------------

test("source scope: supports WHOLE_REPOSITORY, SUBTREE, KNOWN_LIMITED, and UNKNOWN visibility", () => {
  const wholeRepo = createV3Fixture();
  assert.equal(
    assessmentFinalReportV3Schema.parse(wholeRepo).sourceScope.mode,
    ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.WHOLE_REPOSITORY,
  );

  const subtree = createV3Fixture();
  subtree.pins.sourcePathPrefix = "apps/api";
  subtree.sourceScope = {
    mode: ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.SUBTREE,
    visibility: ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_FULL,
    sourcePathPrefix: "apps/api",
    excludedPaths: [],
    limitationReasons: [],
    searchCoverageEvidenceIds: [EVIDENCE_COVERAGE_ID],
  };
  subtree.evidenceIndex[2].searchCoverage = {
    scopes: [
      {
        kind: SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_DIRECTORY,
        path: "apps/api",
      },
    ],
    executedQueriesCount: 1,
    inspectedEntryPointsCount: 1,
    truncatedQueriesCount: 0,
    knownGapsCount: 0,
    directFallbackCount: 0,
    verifiedCompleteness: true,
  };
  assert.equal(
    assessmentFinalReportV3Schema.parse(subtree).sourceScope.sourcePathPrefix,
    "apps/api",
  );

  const knownLimited = createV3Fixture();
  knownLimited.pins.sourcePathPrefix = "apps/api";
  knownLimited.sourceScope = {
    mode: ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.SUBTREE,
    visibility: ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_LIMITED,
    sourcePathPrefix: "apps/api",
    excludedPaths: ["apps/api/generated"],
    limitationReasons: [
      ASSESSMENT_REPORT_SOURCE_VISIBILITY_LIMITATION_REASONS.EXCLUDED_PATHS,
      ASSESSMENT_REPORT_SOURCE_VISIBILITY_LIMITATION_REASONS.SEARCH_TRUNCATED,
    ],
    searchCoverageEvidenceIds: [EVIDENCE_COVERAGE_ID],
  };
  knownLimited.evidenceIndex[2].searchCoverage = {
    scopes: [
      {
        kind: SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_DIRECTORY,
        path: "apps/api",
      },
    ],
    executedQueriesCount: 1,
    inspectedEntryPointsCount: 1,
    truncatedQueriesCount: 1,
    knownGapsCount: 0,
    directFallbackCount: 0,
    verifiedCompleteness: false,
  };
  assert.equal(
    assessmentFinalReportV3Schema.parse(knownLimited).sourceScope.visibility,
    ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_LIMITED,
  );

  const unknownVis = createV3Fixture();
  unknownVis.sourceScope = {
    mode: ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.UNKNOWN,
    visibility: ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.UNKNOWN,
    sourcePathPrefix: null,
    excludedPaths: [],
    limitationReasons: [
      ASSESSMENT_REPORT_SOURCE_VISIBILITY_LIMITATION_REASONS.VISIBILITY_UNKNOWN,
    ],
    searchCoverageEvidenceIds: [],
  };
  assert.equal(
    assessmentFinalReportV3Schema.parse(unknownVis).sourceScope.visibility,
    ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.UNKNOWN,
  );
});

test("source scope: rejects malformed or contradictory scope and refuses to infer whole repository when missing", () => {
  const wholeWithPrefix = createV3Fixture();
  wholeWithPrefix.sourceScope.sourcePathPrefix = "apps/api";
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(wholeWithPrefix).success,
    false,
  );

  const subtreeNoPrefix = createV3Fixture();
  subtreeNoPrefix.sourceScope = {
    mode: ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.SUBTREE,
    visibility: ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_FULL,
    sourcePathPrefix: null,
    excludedPaths: [],
    limitationReasons: [],
    searchCoverageEvidenceIds: [],
  };
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(subtreeNoPrefix).success,
    false,
  );

  const fullWithExclusions = createV3Fixture();
  fullWithExclusions.sourceScope.excludedPaths = ["dist"];
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(fullWithExclusions).success,
    false,
  );

  const limitedNoReason = createV3Fixture();
  limitedNoReason.sourceScope.visibility =
    ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_LIMITED;
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(limitedNoReason).success,
    false,
  );

  const outsideSubtreeEvidence = createV3Fixture();
  outsideSubtreeEvidence.pins.sourcePathPrefix = "apps/web";
  outsideSubtreeEvidence.sourceScope = {
    mode: ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.SUBTREE,
    visibility: ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_FULL,
    sourcePathPrefix: "apps/web",
    excludedPaths: [],
    limitationReasons: [],
    searchCoverageEvidenceIds: [EVIDENCE_COVERAGE_ID],
  };
  outsideSubtreeEvidence.evidenceIndex[2].searchCoverage = {
    scopes: [
      {
        kind: SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_DIRECTORY,
        path: "apps/web",
      },
    ],
    executedQueriesCount: 1,
    inspectedEntryPointsCount: 1,
    truncatedQueriesCount: 0,
    knownGapsCount: 0,
    directFallbackCount: 0,
    verifiedCompleteness: true,
  };
  // EVIDENCE_REPO_ID safeLocator is apps/api/src/retention/purge.ts:10-42
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(outsideSubtreeEvidence).success,
    false,
  );

  // Missing sourceScope on V3 must fail rather than defaulting to WHOLE_REPOSITORY
  const missingScope = createV3Fixture() as Record<string, unknown>;
  delete missingScope.sourceScope;
  assert.equal(assessmentFinalReportV3Schema.safeParse(missingScope).success, false);

  // Legacy missing scope helper never infers WHOLE_REPOSITORY
  const classifiedEmpty = classifyLegacyAssessmentReportSourceScope();
  assert.equal(
    classifiedEmpty.mode,
    ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.UNKNOWN,
  );
  assert.equal(
    classifiedEmpty.visibility,
    ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.UNKNOWN,
  );

  const classifiedNull = classifyLegacyAssessmentReportSourceScope({
    sourcePathPrefix: null,
  });
  assert.equal(
    classifiedNull.mode,
    ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.UNKNOWN,
  );
  assert.equal(
    classifiedNull.visibility,
    ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.UNKNOWN,
  );

  const classifiedSubtree = classifyLegacyAssessmentReportSourceScope({
    sourcePathPrefix: "apps/api",
  });
  assert.equal(
    classifiedSubtree.mode,
    ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.SUBTREE,
  );
  assert.equal(
    classifiedSubtree.visibility,
    ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.UNKNOWN,
  );
  assert.equal(classifiedSubtree.sourcePathPrefix, "apps/api");
});

// ---------------------------------------------------------------------------
// 5. Size boundaries (199/200/201 + UTF-8 vs JS length)
// ---------------------------------------------------------------------------

test("size boundaries: validates 199, 200, and 201 aggregate recommendations without silent loss", () => {
  const r199 = assessmentFinalReportV3Schema.parse(
    createV3Fixture({ recommendationCount: 199 }),
  );
  assert.equal(r199.boundedActionPlan.totalRecommendations, 199);
  assert.equal(r199.boundedActionPlan.omittedCount, 0);
  assert.equal(r199.boundedActionPlan.truncated, false);
  assert.equal(r199.boundedActionPlan.items.length, 199);

  const r200 = assessmentFinalReportV3Schema.parse(
    createV3Fixture({ recommendationCount: 200 }),
  );
  assert.equal(r200.boundedActionPlan.totalRecommendations, 200);
  assert.equal(r200.boundedActionPlan.omittedCount, 0);
  assert.equal(r200.boundedActionPlan.truncated, false);
  assert.equal(r200.boundedActionPlan.items.length, 200);

  // Split 201 across 2 rules (150 + 51) to exercise multi-rule aggregation
  const r201 = createV3Fixture({ recommendationCount: 150 });
  const rule2 = structuredClone(r201.ruleDetails[0]);
  rule2.assessmentRuleId = "rule-2";
  rule2.decisionId = DECISION_ID_2;
  rule2.decision.assessmentRuleId = "rule-2";
  rule2.narrative.recommendations = Array.from(
    { length: 51 },
    (_, index) => `Rule 2 remediation ${index + 1}.`,
  );
  r201.ruleDetails.push(rule2);
  r201.outcomeSummary.totalRules = 2;
  r201.outcomeSummary.applicableCompliant = 2;
  r201.boundedActionPlan = {
    maxHighlightItems: ASSESSMENT_REPORT_V3_LIMITS.MAX_ACTION_PLAN_HIGHLIGHTS,
    totalRecommendations: 201,
    omittedCount: 1,
    truncated: true,
    items: [
      ...r201.ruleDetails[0].narrative.recommendations.map((_summary, index) => ({
        actionId: `rule-1#${index}`,
        assessmentRuleId: "rule-1",
        ruleDetailRef: "/ruleDetails/0",
        recommendationIndex: index,
        priority: ASSESSMENT_REPORT_ACTION_PRIORITIES.LOW,
      })),
      ...rule2.narrative.recommendations.slice(0, 50).map((_summary, index) => ({
        actionId: `rule-2#${index}`,
        assessmentRuleId: "rule-2",
        ruleDetailRef: "/ruleDetails/1",
        recommendationIndex: index,
        priority: ASSESSMENT_REPORT_ACTION_PRIORITIES.LOW,
      })),
    ],
  };

  const parsed201 = assessmentFinalReportV3Schema.parse(r201);
  assert.equal(parsed201.boundedActionPlan.totalRecommendations, 201);
  assert.equal(parsed201.boundedActionPlan.items.length, 200);
  assert.equal(parsed201.boundedActionPlan.omittedCount, 1);
  assert.equal(parsed201.boundedActionPlan.truncated, true);
  // Original recommendations are preserved without silent loss
  assert.equal(
    parsed201.ruleDetails[0].narrative.recommendations.length +
      parsed201.ruleDetails[1].narrative.recommendations.length,
    201,
  );

  // Silent truncation (claiming truncated: false on 201) must fail
  const silentTruncation = structuredClone(r201);
  silentTruncation.boundedActionPlan.truncated = false;
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(silentTruncation).success,
    false,
  );

  // Exceeding 200 items in boundedActionPlan.items must fail
  const overflowItems = structuredClone(r201);
  overflowItems.boundedActionPlan.items.push({
    actionId: "rule-2#50",
    assessmentRuleId: "rule-2",
    ruleDetailRef: "/ruleDetails/1",
    recommendationIndex: 50,
    priority: ASSESSMENT_REPORT_ACTION_PRIORITIES.LOW,
  });
  overflowItems.boundedActionPlan.omittedCount = 0;
  overflowItems.boundedActionPlan.truncated = false;
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(overflowItems).success,
    false,
  );
});

test("size boundaries: distinguishes UTF-8 byte length from JS UTF-16 string length", () => {
  const viText = "ệ".repeat(100);
  assert.equal(viText.length, 100);
  assert.equal(utf8ByteLength(viText), 300);

  const emojiText = "😀".repeat(100);
  assert.equal(emojiText.length, 200);
  assert.equal(utf8ByteLength(emojiText), 400);

  // Fits within MAX_TEXT_CHARS (10,000) and MAX_TEXT_UTF8_BYTES (24,000)
  const validViReport = createV3Fixture();
  validViReport.boundedNarrative.summary = "ệ".repeat(8_000);
  const parsedVi = assessmentFinalReportV3Schema.parse(validViReport);
  const measurement = measureAssessmentFinalReportV3Size(parsedVi);
  assert.ok(measurement.utf8Bytes > measurement.jsLength);

  // Within JS char limit (8,001 <= 10,000) but exceeds UTF-8 byte limit (24,003 > 24,000) -> rejected
  const oversizedUtf8Report = createV3Fixture();
  oversizedUtf8Report.boundedNarrative.summary = "ệ".repeat(8_001);
  assert.equal(oversizedUtf8Report.boundedNarrative.summary.length, 8_001);
  assert.equal(
    utf8ByteLength(oversizedUtf8Report.boundedNarrative.summary),
    24_003,
  );
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(oversizedUtf8Report).success,
    false,
  );
});

// ---------------------------------------------------------------------------
// 6. Localization field classification
// ---------------------------------------------------------------------------

test("localization compatibility: explicit V3 field classification distinguishes canonical, localizable, and protected data", () => {
  const byClass = new Map<string, number>();
  for (const entry of ASSESSMENT_FINAL_REPORT_V3_FIELD_PATH_CLASSIFICATIONS) {
    byClass.set(entry.classification, (byClass.get(entry.classification) ?? 0) + 1);
  }
  assert.ok(
    (byClass.get(ASSESSMENT_REPORT_FIELD_CLASSIFICATIONS.CANONICAL_AUTHORITATIVE) ??
      0) > 0,
  );
  assert.ok(
    (byClass.get(ASSESSMENT_REPORT_FIELD_CLASSIFICATIONS.LOCALIZABLE_NARRATIVE) ??
      0) > 0,
  );
  assert.ok(
    (byClass.get(ASSESSMENT_REPORT_FIELD_CLASSIFICATIONS.PROTECTED_DATA) ?? 0) >
      0,
  );

  // Every localizable entry must be flagged as included by B1 authoredFields, and non-localizable must never be included
  for (const entry of ASSESSMENT_FINAL_REPORT_V3_FIELD_PATH_CLASSIFICATIONS) {
    if (
      entry.classification ===
      ASSESSMENT_REPORT_FIELD_CLASSIFICATIONS.LOCALIZABLE_NARRATIVE
    ) {
      assert.equal(
        entry.b1AuthoredFieldsIncluded,
        true,
        `Narrative path ${entry.pathPattern} should be localizable`,
      );
    } else {
      assert.equal(
        entry.b1AuthoredFieldsIncluded,
        false,
        `Non-narrative path ${entry.pathPattern} must not be treated as translatable`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 7. PR #481 C1 review regressions (P1-01, P1-02, P1-03, P2-01, P2-02)
// ---------------------------------------------------------------------------

test("P1-01: rejects malformed, non-canonical, traversal, and excluded REPOSITORY_SOURCE locators", () => {
  const malformedUnderSubtree = createV3Fixture();
  malformedUnderSubtree.pins.sourcePathPrefix = "apps/api";
  malformedUnderSubtree.sourceScope = {
    mode: ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.SUBTREE,
    visibility: ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_FULL,
    sourcePathPrefix: "apps/api",
    excludedPaths: [],
    limitationReasons: [],
    searchCoverageEvidenceIds: [EVIDENCE_COVERAGE_ID],
  };
  malformedUnderSubtree.evidenceIndex[2].searchCoverage = {
    scopes: [
      {
        kind: SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_DIRECTORY,
        path: "apps/api",
      },
    ],
    executedQueriesCount: 1,
    inspectedEntryPointsCount: 1,
    truncatedQueriesCount: 0,
    knownGapsCount: 0,
    directFallbackCount: 0,
    verifiedCompleteness: true,
  };
  malformedUnderSubtree.evidenceIndex[1].safeLocator =
    "apps/web/outside.ts:invalid-range";
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(malformedUnderSubtree).success,
    false,
  );

  for (const badLocator of [
    "apps/api/../apps/web/outside.ts:1-5",
    "/apps/api/src/retention/purge.ts:1-5",
    "apps/api/src/retention/purge.ts:20-10",
    "apps/api/src/retention/purge.ts:0-5",
    "apps/api/src/retention/purge.ts:1-2001",
    "apps/api/src/retention/purge.ts",
  ]) {
    const candidate = createV3Fixture();
    candidate.evidenceIndex[1].safeLocator = badLocator;
    assert.equal(
      assessmentFinalReportV3Schema.safeParse(candidate).success,
      false,
      `Expected malformed locator to be rejected: ${badLocator}`,
    );
  }

  const excludedLocator = createV3Fixture();
  excludedLocator.pins.sourcePathPrefix = "apps/api";
  excludedLocator.sourceScope = {
    mode: ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.SUBTREE,
    visibility: ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_LIMITED,
    sourcePathPrefix: "apps/api",
    excludedPaths: ["apps/api/src/retention"],
    limitationReasons: [
      ASSESSMENT_REPORT_SOURCE_VISIBILITY_LIMITATION_REASONS.EXCLUDED_PATHS,
    ],
    searchCoverageEvidenceIds: [],
  };
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(excludedLocator).success,
    false,
  );
});

test("P1-02: prevents contradictory criterion statements on criteriaDecisions by enforcing single canonical source", () => {
  const contradictory = createV3Fixture();
  (
    contradictory.ruleDetails[0].criteriaDecisions[0] as Record<string, unknown>
  ).statement = "CONTRADICTORY: No retention purge job is required.";
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(contradictory).success,
    false,
  );
});

test("P1-03: prevents independently mutable action summaries and derives presentation text from canonical rule recommendations", () => {
  const contradictoryAction = createV3Fixture();
  (
    contradictoryAction.boundedActionPlan.items[0] as Record<string, unknown>
  ).summary = "CONTRADICTORY: Disable retention purge and ignore compliance.";
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(contradictoryAction).success,
    false,
  );

  const valid = assessmentFinalReportV3Schema.parse(createV3Fixture());
  const resolved = resolveV3BoundedActionPlanItems(valid);
  assert.deepEqual(resolved, [
    {
      actionId: "rule-1#0",
      assessmentRuleId: "rule-1",
      ruleDetailRef: "/ruleDetails/0",
      recommendationIndex: 0,
      priority: ASSESSMENT_REPORT_ACTION_PRIORITIES.LOW,
      recommendation: "Actionable remediation step 1.",
    },
  ]);
});

test("P2-01: validates decision.legalContextRefs as a non-empty unique subset of rule.legalRequirementIds", () => {
  // Positive control: linked subset when rule links two requirements and decision cites one
  const linkedSubset = createV3Fixture();
  linkedSubset.legalRequirements.push({
    ...linkedSubset.legalRequirements[0],
    legalRequirementId: "req-2",
  });
  linkedSubset.ruleDetails[0].legalRequirementIds = ["req-1", "req-2"];
  linkedSubset.ruleDetails[0].decision.legalContextRefs = [
    { legalContextId: "req-1" },
  ];
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(linkedSubset).success,
    true,
  );

  // Unknown legalContextId
  const unknownContext = createV3Fixture();
  unknownContext.ruleDetails[0].decision.legalContextRefs = [
    { legalContextId: "req-unknown" },
  ];
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(unknownContext).success,
    false,
  );

  // Duplicate legalContextId
  const duplicateContext = createV3Fixture();
  duplicateContext.ruleDetails[0].decision.legalContextRefs = [
    { legalContextId: "req-1" },
    { legalContextId: "req-1" },
  ];
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(duplicateContext).success,
    false,
  );

  // Unlinked legalContextId (exists in report.legalRequirements but NOT in rule.legalRequirementIds)
  const unlinkedContext = createV3Fixture();
  unlinkedContext.legalRequirements.push({
    ...unlinkedContext.legalRequirements[0],
    legalRequirementId: "req-2",
  });
  unlinkedContext.ruleDetails[0].decision.legalContextRefs = [
    { legalContextId: "req-2" },
  ];
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(unlinkedContext).success,
    false,
  );
});

test("P2-02: preserves historical V2 reference-origin value set while supporting APPLICABILITY_BASIS in V3", () => {
  assert.deepEqual(
    Object.values(ASSESSMENT_REPORT_REFERENCE_ORIGINS).sort(),
    ["CRITERION", "DECISION", "FACT_EVIDENCE"],
  );
  for (const origin of Object.values(ASSESSMENT_REPORT_REFERENCE_ORIGINS)) {
    assert.equal(
      assessmentReportDecisionReferenceSchema.safeParse({
        origin,
        reference: {
          type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
          evidenceId: EVIDENCE_REPO_ID,
        },
      }).success,
      true,
    );
  }
  assert.equal(
    assessmentReportDecisionReferenceSchema.safeParse({
      origin: ASSESSMENT_REPORT_V3_REFERENCE_ORIGINS.applicabilityBasis,
      reference: {
        type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
        evidenceId: EVIDENCE_REPO_ID,
      },
    }).success,
    false,
  );
  assert.equal(
    assessmentReportApplicabilityBasisReferenceSchema.safeParse({
      origin: ASSESSMENT_REPORT_V3_REFERENCE_ORIGINS.applicabilityBasis,
      legalRequirementId: "req-1",
      kind: RULE_DECISION_BASIS_KINDS.APPLICABILITY_CONDITION,
      index: 0,
      reference: {
        type: RULE_DECISION_REFERENCE_TYPES.CONFIRMED_FACT,
        factId: FACT_HUMAN_ID,
        caseRevision: 1,
      },
    }).success,
    true,
  );
});

test("P1-04: authorizes direct and pinned related legal contexts while rejecting unknown, unrelated, or duplicate contexts", () => {
  // Positive control: rule links req-1 directly and relates req-2 via a pinned LegalRequirementContextRelation
  const withRelatedContext = createV3Fixture();
  withRelatedContext.legalRequirements.push({
    ...withRelatedContext.legalRequirements[0],
    legalRequirementId: "req-2",
    title: "Defined personal record term",
    sourceRefs: [sourceRef("law-def")],
  });
  withRelatedContext.ruleDetails[0].relatedLegalContexts = [
    {
      relationId: "rel-1",
      kind: LEGAL_CONTEXT_RELATION_KINDS.DEFINITION,
      fromLegalRequirementId: "req-1",
      toLegalRequirementId: "req-2",
      sourceRefs: [sourceRef("law-def")],
    },
  ];
  withRelatedContext.ruleDetails[0].decision.legalContextRefs = [
    { legalContextId: "req-1" },
    { legalContextId: "req-2" },
  ];
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(withRelatedContext).success,
    true,
  );

  // Reject unrelated requirement without any pinned relation on the rule
  const unrelatedWithoutRelation = createV3Fixture();
  unrelatedWithoutRelation.legalRequirements.push({
    ...unrelatedWithoutRelation.legalRequirements[0],
    legalRequirementId: "req-2",
  });
  unrelatedWithoutRelation.ruleDetails[0].decision.legalContextRefs = [
    { legalContextId: "req-1" },
    { legalContextId: "req-2" },
  ];
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(unrelatedWithoutRelation).success,
    false,
  );

  // Reject fabricated relation whose fromLegalRequirementId is not directly linked to this rule
  const unlinkedRelationOrigin = createV3Fixture();
  unlinkedRelationOrigin.legalRequirements.push(
    {
      ...unlinkedRelationOrigin.legalRequirements[0],
      legalRequirementId: "req-2",
    },
    {
      ...unlinkedRelationOrigin.legalRequirements[0],
      legalRequirementId: "req-3",
    },
  );
  unlinkedRelationOrigin.ruleDetails[0].relatedLegalContexts = [
    {
      relationId: "rel-bad-origin",
      kind: LEGAL_CONTEXT_RELATION_KINDS.EXCEPTION,
      fromLegalRequirementId: "req-3",
      toLegalRequirementId: "req-2",
      sourceRefs: [sourceRef("law-def")],
    },
  ];
  unlinkedRelationOrigin.ruleDetails[0].decision.legalContextRefs = [
    { legalContextId: "req-1" },
    { legalContextId: "req-2" },
  ];
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(unlinkedRelationOrigin).success,
    false,
  );

  // Reject relation targeting an unknown LegalRequirement not present in report.legalRequirements
  const missingTarget = createV3Fixture();
  missingTarget.ruleDetails[0].relatedLegalContexts = [
    {
      relationId: "rel-missing-target",
      kind: LEGAL_CONTEXT_RELATION_KINDS.CROSS_REFERENCE,
      fromLegalRequirementId: "req-1",
      toLegalRequirementId: "req-missing",
      sourceRefs: [sourceRef("law-def")],
    },
  ];
  missingTarget.ruleDetails[0].decision.legalContextRefs = [
    { legalContextId: "req-1" },
    { legalContextId: "req-missing" },
  ];
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(missingTarget).success,
    false,
  );

  // Reject relation whose sourceRefs legalSourceVersion disagrees with pinned version
  const unpinnedRelationSource = createV3Fixture();
  unpinnedRelationSource.legalRequirements.push({
    ...unpinnedRelationSource.legalRequirements[0],
    legalRequirementId: "req-2",
  });
  unpinnedRelationSource.ruleDetails[0].relatedLegalContexts = [
    {
      relationId: "rel-bad-pin",
      kind: LEGAL_CONTEXT_RELATION_KINDS.DEFINITION,
      fromLegalRequirementId: "req-1",
      toLegalRequirementId: "req-2",
      sourceRefs: [
        {
          ...sourceRef("law-def"),
          legalSourceVersion: "LAW-STALE",
        },
      ],
    },
  ];
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(unpinnedRelationSource).success,
    false,
  );

  // Reject duplicate relationId or duplicate legalContextId via related contexts
  const duplicateRelation = createV3Fixture();
  duplicateRelation.legalRequirements.push({
    ...duplicateRelation.legalRequirements[0],
    legalRequirementId: "req-2",
  });
  duplicateRelation.ruleDetails[0].relatedLegalContexts = [
    {
      relationId: "rel-dup",
      kind: LEGAL_CONTEXT_RELATION_KINDS.DEFINITION,
      fromLegalRequirementId: "req-1",
      toLegalRequirementId: "req-2",
      sourceRefs: [sourceRef("law-def")],
    },
    {
      relationId: "rel-dup",
      kind: LEGAL_CONTEXT_RELATION_KINDS.CROSS_REFERENCE,
      fromLegalRequirementId: "req-1",
      toLegalRequirementId: "req-2",
      sourceRefs: [sourceRef("law-def")],
    },
  ];
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(duplicateRelation).success,
    false,
  );

  // Reject duplicate cited related context
  const duplicateCitedRelated = createV3Fixture();
  duplicateCitedRelated.legalRequirements.push({
    ...duplicateCitedRelated.legalRequirements[0],
    legalRequirementId: "req-2",
  });
  duplicateCitedRelated.ruleDetails[0].relatedLegalContexts = [
    {
      relationId: "rel-1",
      kind: LEGAL_CONTEXT_RELATION_KINDS.DEFINITION,
      fromLegalRequirementId: "req-1",
      toLegalRequirementId: "req-2",
      sourceRefs: [sourceRef("law-def")],
    },
  ];
  duplicateCitedRelated.ruleDetails[0].decision.legalContextRefs = [
    { legalContextId: "req-2" },
    { legalContextId: "req-2" },
  ];
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(duplicateCitedRelated).success,
    false,
  );
});

test("P1-05: binds sourceScope to pinned snapshot prefix and requires verified non-truncated coverage for KNOWN_FULL", () => {
  // 1. Pinned apps/api + matching SUBTREE PASS
  const pinnedSubtree = createV3Fixture();
  pinnedSubtree.pins.sourcePathPrefix = "apps/api";
  pinnedSubtree.sourceScope = {
    mode: ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.SUBTREE,
    visibility: ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_FULL,
    sourcePathPrefix: "apps/api",
    excludedPaths: [],
    limitationReasons: [],
    searchCoverageEvidenceIds: [EVIDENCE_COVERAGE_ID],
  };
  pinnedSubtree.evidenceIndex[2].searchCoverage = {
    scopes: [
      {
        kind: SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_DIRECTORY,
        path: "apps/api",
      },
    ],
    executedQueriesCount: 1,
    inspectedEntryPointsCount: 1,
    truncatedQueriesCount: 0,
    knownGapsCount: 0,
    directFallbackCount: 0,
    verifiedCompleteness: true,
  };
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(pinnedSubtree).success,
    true,
  );

  // 2. Pinned apps/api + WHOLE_REPOSITORY REJECT
  const pinnedSubtreeClaimingWhole = createV3Fixture();
  pinnedSubtreeClaimingWhole.pins.sourcePathPrefix = "apps/api";
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(pinnedSubtreeClaimingWhole).success,
    false,
  );

  // 3. Pinned apps/api + mismatched subtree apps/web REJECT
  const pinnedSubtreeClaimingWeb = createV3Fixture();
  pinnedSubtreeClaimingWeb.pins.sourcePathPrefix = "apps/api";
  pinnedSubtreeClaimingWeb.sourceScope = {
    mode: ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.SUBTREE,
    visibility: ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_LIMITED,
    sourcePathPrefix: "apps/web",
    excludedPaths: [],
    limitationReasons: [
      ASSESSMENT_REPORT_SOURCE_VISIBILITY_LIMITATION_REASONS.PARTIAL_COVERAGE_RECORDED,
    ],
    searchCoverageEvidenceIds: [],
  };
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(pinnedSubtreeClaimingWeb).success,
    false,
  );

  // 4. Pinned whole repo (null) + unsupported SUBTREE scope REJECT
  const pinnedWholeClaimingSubtree = createV3Fixture();
  pinnedWholeClaimingSubtree.pins.sourcePathPrefix = null;
  pinnedWholeClaimingSubtree.sourceScope = {
    mode: ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.SUBTREE,
    visibility: ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_FULL,
    sourcePathPrefix: "apps/api",
    excludedPaths: [],
    limitationReasons: [],
    searchCoverageEvidenceIds: [EVIDENCE_COVERAGE_ID],
  };
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(pinnedWholeClaimingSubtree).success,
    false,
  );

  // 5. UNKNOWN visibility/mode preserved for both pinned whole-repo and pinned subtree
  const unknownWhole = createV3Fixture();
  unknownWhole.pins.sourcePathPrefix = null;
  unknownWhole.sourceScope = {
    mode: ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.UNKNOWN,
    visibility: ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.UNKNOWN,
    sourcePathPrefix: null,
    excludedPaths: [],
    limitationReasons: [
      ASSESSMENT_REPORT_SOURCE_VISIBILITY_LIMITATION_REASONS.VISIBILITY_UNKNOWN,
    ],
    searchCoverageEvidenceIds: [],
  };
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(unknownWhole).success,
    true,
  );

  const unknownSubtree = createV3Fixture();
  unknownSubtree.pins.sourcePathPrefix = "apps/api";
  unknownSubtree.sourceScope = {
    mode: ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.UNKNOWN,
    visibility: ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.UNKNOWN,
    sourcePathPrefix: null,
    excludedPaths: [],
    limitationReasons: [
      ASSESSMENT_REPORT_SOURCE_VISIBILITY_LIMITATION_REASONS.VISIBILITY_UNKNOWN,
    ],
    searchCoverageEvidenceIds: [],
  };
  unknownSubtree.evidenceIndex[2].searchCoverage = {
    scopes: [
      {
        kind: SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_DIRECTORY,
        path: "apps/api",
      },
    ],
    executedQueriesCount: 1,
    inspectedEntryPointsCount: 1,
    truncatedQueriesCount: 0,
    knownGapsCount: 0,
    directFallbackCount: 0,
    verifiedCompleteness: true,
  };
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(unknownSubtree).success,
    true,
  );

  // 6. Evidence outside authorized pinned prefix even when sourceScope is UNKNOWN REJECT
  const outsidePinnedPrefixUnknown = createV3Fixture();
  outsidePinnedPrefixUnknown.pins.sourcePathPrefix = "apps/api";
  outsidePinnedPrefixUnknown.sourceScope = {
    mode: ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.UNKNOWN,
    visibility: ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.UNKNOWN,
    sourcePathPrefix: null,
    excludedPaths: [],
    limitationReasons: [
      ASSESSMENT_REPORT_SOURCE_VISIBILITY_LIMITATION_REASONS.VISIBILITY_UNKNOWN,
    ],
    searchCoverageEvidenceIds: [],
  };
  outsidePinnedPrefixUnknown.evidenceIndex[2].searchCoverage = {
    scopes: [
      {
        kind: SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_DIRECTORY,
        path: "apps/api",
      },
    ],
    executedQueriesCount: 1,
    inspectedEntryPointsCount: 1,
    truncatedQueriesCount: 0,
    knownGapsCount: 0,
    directFallbackCount: 0,
    verifiedCompleteness: true,
  };
  outsidePinnedPrefixUnknown.evidenceIndex[1].safeLocator =
    "apps/web/outside.ts:10-20";
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(outsidePinnedPrefixUnknown).success,
    false,
  );

  // 7. Missing/unverified/truncated/gapped coverage cannot establish KNOWN_FULL
  const fullWithoutCoverageIds = createV3Fixture();
  fullWithoutCoverageIds.sourceScope.searchCoverageEvidenceIds = [];
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(fullWithoutCoverageIds).success,
    false,
  );

  const fullWithoutMetadata = createV3Fixture();
  delete fullWithoutMetadata.evidenceIndex[2].searchCoverage;
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(fullWithoutMetadata).success,
    false,
  );

  const fullWithTruncatedQueries = createV3Fixture();
  fullWithTruncatedQueries.evidenceIndex[2].searchCoverage = {
    scopes: [
      {
        kind: SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_DIRECTORY,
        path: ".",
      },
    ],
    executedQueriesCount: 1,
    inspectedEntryPointsCount: 1,
    truncatedQueriesCount: 1,
    knownGapsCount: 0,
    directFallbackCount: 0,
    verifiedCompleteness: false,
  };
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(fullWithTruncatedQueries).success,
    false,
  );

  const fullWithKnownGaps = createV3Fixture();
  fullWithKnownGaps.evidenceIndex[2].searchCoverage = {
    scopes: [
      {
        kind: SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_DIRECTORY,
        path: ".",
      },
    ],
    executedQueriesCount: 1,
    inspectedEntryPointsCount: 1,
    truncatedQueriesCount: 0,
    knownGapsCount: 2,
    directFallbackCount: 0,
    verifiedCompleteness: false,
  };
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(fullWithKnownGaps).success,
    false,
  );

  const fullWholeRepoOnlyNarrowScope = createV3Fixture();
  fullWholeRepoOnlyNarrowScope.evidenceIndex[2].searchCoverage = {
    scopes: [
      {
        kind: SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_DIRECTORY,
        path: "apps/api",
      },
    ],
    executedQueriesCount: 1,
    inspectedEntryPointsCount: 1,
    truncatedQueriesCount: 0,
    knownGapsCount: 0,
    directFallbackCount: 0,
    verifiedCompleteness: true,
  };
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(fullWholeRepoOnlyNarrowScope)
      .success,
    false,
  );
});

test("P1-06: enforces KNOWN_FULL coverage authority and rejects unverified or superficial coverage", () => {
  // 1. Root-scoped coverage record without meaningful search activity (0 queries, 0 entry points) REJECT
  const noActivity = createV3Fixture();
  noActivity.evidenceIndex[2].searchCoverage = {
    scopes: [
      {
        kind: SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_DIRECTORY,
        path: ".",
      },
    ],
    executedQueriesCount: 0,
    inspectedEntryPointsCount: 0,
    truncatedQueriesCount: 0,
    knownGapsCount: 0,
    directFallbackCount: 0,
    verifiedCompleteness: true,
  };
  const noActivityParsed = assessmentFinalReportV3Schema.safeParse(noActivity);
  assert.equal(noActivityParsed.success, false);
  assert.match(
    noActivityParsed.error.issues.map((i) => i.message).join(" "),
    /lacks meaningful search activity/,
  );

  // 2. GRAPH_INDEX or SOURCE_FILE scope used as proof of whole-repository completeness REJECT
  const graphIndexScope = createV3Fixture();
  graphIndexScope.evidenceIndex[2].searchCoverage = {
    scopes: [
      {
        kind: SEARCH_COVERAGE_SCOPE_KINDS.GRAPH_INDEX,
        path: ".",
      },
    ],
    executedQueriesCount: 10,
    inspectedEntryPointsCount: 5,
    truncatedQueriesCount: 0,
    knownGapsCount: 0,
    directFallbackCount: 0,
    verifiedCompleteness: true,
  };
  const graphIndexParsed =
    assessmentFinalReportV3Schema.safeParse(graphIndexScope);
  assert.equal(graphIndexParsed.success, false);
  assert.match(
    graphIndexParsed.error.issues.map((i) => i.message).join(" "),
    /requires verified SOURCE_DIRECTORY search coverage covering repository root/,
  );

  const sourceFileScope = createV3Fixture();
  sourceFileScope.evidenceIndex[2].searchCoverage = {
    scopes: [
      {
        kind: SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_FILE,
        path: "package.json",
      },
    ],
    executedQueriesCount: 5,
    inspectedEntryPointsCount: 1,
    truncatedQueriesCount: 0,
    knownGapsCount: 0,
    directFallbackCount: 0,
    verifiedCompleteness: true,
  };
  const sourceFileParsed =
    assessmentFinalReportV3Schema.safeParse(sourceFileScope);
  assert.equal(sourceFileParsed.success, false);
  assert.match(
    sourceFileParsed.error.issues.map((i) => i.message).join(" "),
    /requires verified SOURCE_DIRECTORY search coverage covering repository root/,
  );

  // 3. Zero recorded gaps even though actual coverage completeness is unproven (verifiedCompleteness: false) REJECT
  const unverifiedCompleteness = createV3Fixture();
  unverifiedCompleteness.evidenceIndex[2].searchCoverage = {
    scopes: [
      {
        kind: SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_DIRECTORY,
        path: ".",
      },
    ],
    executedQueriesCount: 15,
    inspectedEntryPointsCount: 6,
    truncatedQueriesCount: 0,
    knownGapsCount: 0,
    directFallbackCount: 0,
    verifiedCompleteness: false,
  };
  const unverifiedParsed = assessmentFinalReportV3Schema.safeParse(
    unverifiedCompleteness,
  );
  assert.equal(unverifiedParsed.success, false);
  assert.match(
    unverifiedParsed.error.issues.map((i) => i.message).join(" "),
    /unverified completeness \(Root observation only\) and cannot establish KNOWN_FULL visibility/,
  );

  // 4. Coverage metadata with invalid, insufficient or inconsistent provenance REJECT
  // 4a. verifiedCompleteness: true but truncatedQueriesCount > 0
  const inconsistentTruncated = createV3Fixture();
  inconsistentTruncated.evidenceIndex[2].searchCoverage = {
    scopes: [
      {
        kind: SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_DIRECTORY,
        path: ".",
      },
    ],
    executedQueriesCount: 10,
    inspectedEntryPointsCount: 4,
    truncatedQueriesCount: 2,
    knownGapsCount: 0,
    directFallbackCount: 0,
    verifiedCompleteness: true,
  };
  const inconsistentTruncatedParsed = assessmentFinalReportV3Schema.safeParse(
    inconsistentTruncated,
  );
  assert.equal(inconsistentTruncatedParsed.success, false);
  assert.match(
    inconsistentTruncatedParsed.error.issues.map((i) => i.message).join(" "),
    /cannot claim verifiedCompleteness when truncated queries exist/,
  );

  // 4b. verifiedCompleteness: true but knownGapsCount > 0
  const inconsistentGaps = createV3Fixture();
  inconsistentGaps.evidenceIndex[2].searchCoverage = {
    scopes: [
      {
        kind: SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_DIRECTORY,
        path: ".",
      },
    ],
    executedQueriesCount: 10,
    inspectedEntryPointsCount: 4,
    truncatedQueriesCount: 0,
    knownGapsCount: 3,
    directFallbackCount: 0,
    verifiedCompleteness: true,
  };
  const inconsistentGapsParsed =
    assessmentFinalReportV3Schema.safeParse(inconsistentGaps);
  assert.equal(inconsistentGapsParsed.success, false);
  assert.match(
    inconsistentGapsParsed.error.issues.map((i) => i.message).join(" "),
    /cannot claim verifiedCompleteness when known gaps exist/,
  );

  // 4c. verifiedCompleteness: true but 0 queries and 0 entry points (checked on item itself in invariant)
  const inconsistentZeroActivity = createV3Fixture();
  inconsistentZeroActivity.sourceScope.visibility =
    ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_LIMITED;
  inconsistentZeroActivity.sourceScope.limitationReasons = [
    ASSESSMENT_REPORT_SOURCE_VISIBILITY_LIMITATION_REASONS.PARTIAL_COVERAGE_RECORDED,
  ];
  inconsistentZeroActivity.evidenceIndex[2].searchCoverage = {
    scopes: [
      {
        kind: SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_DIRECTORY,
        path: ".",
      },
    ],
    executedQueriesCount: 0,
    inspectedEntryPointsCount: 0,
    truncatedQueriesCount: 0,
    knownGapsCount: 0,
    directFallbackCount: 0,
    verifiedCompleteness: true,
  };
  const inconsistentZeroActivityParsed = assessmentFinalReportV3Schema.safeParse(
    inconsistentZeroActivity,
  );
  assert.equal(inconsistentZeroActivityParsed.success, false);
  assert.match(
    inconsistentZeroActivityParsed.error.issues.map((i) => i.message).join(" "),
    /cannot claim verifiedCompleteness without meaningful search activity/,
  );

  // 5. A report claiming KNOWN_FULL when only UNKNOWN or KNOWN_LIMITED is justified
  const unverifiedAgentObservation = createV3Fixture();
  unverifiedAgentObservation.evidenceIndex[2].searchCoverage = {
    scopes: [
      {
        kind: SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_DIRECTORY,
        path: ".",
      },
    ],
    executedQueriesCount: 20,
    inspectedEntryPointsCount: 8,
    truncatedQueriesCount: 0,
    knownGapsCount: 0,
    directFallbackCount: 0,
    verifiedCompleteness: false,
  };
  // Claiming KNOWN_FULL fails
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(unverifiedAgentObservation).success,
    false,
  );

  // Changing to conservative KNOWN_LIMITED succeeds
  const conservativeLimited = {
    ...unverifiedAgentObservation,
    sourceScope: {
      ...unverifiedAgentObservation.sourceScope,
      visibility: ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_LIMITED,
      limitationReasons: [
        ASSESSMENT_REPORT_SOURCE_VISIBILITY_LIMITATION_REASONS.PARTIAL_COVERAGE_RECORDED,
      ],
    },
  };
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(conservativeLimited).success,
    true,
  );

  // Changing to conservative UNKNOWN succeeds
  const conservativeUnknown = {
    ...unverifiedAgentObservation,
    sourceScope: {
      mode: ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.UNKNOWN,
      visibility: ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.UNKNOWN,
      sourcePathPrefix: null,
      excludedPaths: [],
      limitationReasons: [
        ASSESSMENT_REPORT_SOURCE_VISIBILITY_LIMITATION_REASONS.VISIBILITY_UNKNOWN,
      ],
      searchCoverageEvidenceIds: [],
    },
  };
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(conservativeUnknown).success,
    true,
  );

  // 6. Positive cases: genuine trusted coverage evidence
  // 6a. Trusted WHOLE_REPOSITORY KNOWN_FULL
  const trustedWhole = createV3Fixture();
  trustedWhole.evidenceIndex[2].searchCoverage = {
    scopes: [
      {
        kind: SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_DIRECTORY,
        path: ".",
      },
    ],
    executedQueriesCount: 25,
    inspectedEntryPointsCount: 7,
    truncatedQueriesCount: 0,
    knownGapsCount: 0,
    directFallbackCount: 0,
    verifiedCompleteness: true,
  };
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(trustedWhole).success,
    true,
  );

  // 6b. Trusted SUBTREE KNOWN_FULL
  const trustedSubtree = createV3Fixture();
  trustedSubtree.pins.sourcePathPrefix = "apps/api";
  trustedSubtree.sourceScope = {
    mode: ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.SUBTREE,
    visibility: ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_FULL,
    sourcePathPrefix: "apps/api",
    excludedPaths: [],
    limitationReasons: [],
    searchCoverageEvidenceIds: [EVIDENCE_COVERAGE_ID],
  };
  trustedSubtree.evidenceIndex[2].searchCoverage = {
    scopes: [
      {
        kind: SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_DIRECTORY,
        path: "apps/api",
      },
    ],
    executedQueriesCount: 14,
    inspectedEntryPointsCount: 4,
    truncatedQueriesCount: 0,
    knownGapsCount: 0,
    directFallbackCount: 0,
    verifiedCompleteness: true,
  };
  assert.equal(
    assessmentFinalReportV3Schema.safeParse(trustedSubtree).success,
    true,
  );
});

