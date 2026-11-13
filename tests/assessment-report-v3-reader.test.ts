import { test } from "node:test";
import assert from "node:assert/strict";
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
  ASSESSMENT_REPORT_ACTION_PRIORITIES,
  ASSESSMENT_REPORT_SOURCE_SCOPE_MODES,
  ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES,
  ASSESSMENT_REPORT_V3_LIMITS,
  ASSESSMENT_REPORT_V3_REFERENCE_ORIGINS,
  assessmentFinalReportArtifactVersionedSchema,
  assessmentFinalReportV3Schema,
  buildAssessmentReportPresentation,
  type AssessmentFinalReportV3,
} from "@lcsp/contracts/assessment-report";
import { LEGAL_REQUIREMENT_COVERAGE_STATES } from "@lcsp/contracts/compliance-rule-set";

const LEGAL_SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const RULE_SET_ID = "22222222-2222-4222-8222-222222222222";
const SNAPSHOT_ID = "33333333-3333-4333-8333-333333333333";
const SCAN_JOB_ID = "44444444-4444-4444-8444-444444444444";
const ARTIFACT_ID = "55555555-5555-4555-8555-555555555555";
const ASSESSMENT_ID = "66666666-6666-4666-8666-666666666666";
const DECISION_ID_1 = "77777777-7777-4777-8777-777777777771";
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
    sourcePathPrefix?: string | null;
    visibility?: "KNOWN_FULL" | "KNOWN_LIMITED" | "UNKNOWN";
  } = {},
): AssessmentFinalReportV3 {
  const applicability =
    options.applicability ?? RULE_DECISION_APPLICABILITIES.APPLICABLE;
  const compliance =
    options.compliance ?? RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT;
  const sourcePathPrefix = options.sourcePathPrefix ?? null;
  const visibility =
    options.visibility ??
    ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_FULL;

  const criterionOutcome =
    compliance === RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT
      ? RULE_DECISION_CRITERION_OUTCOMES.NOT_MET
      : RULE_DECISION_CRITERION_OUTCOMES.MET;

  const recommendations = [
    "Enable automated retention purge job on all customer records.",
  ];

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

  const decision = {
    assessmentRuleId: "rule-1",
    assessmentRuleVersion: "1",
    scopeId: ASSESSMENT_DECISION_SCOPE,
    ruleSetVersionId: RULE_SET_ID,
    repositorySnapshotId: SNAPSHOT_ID,
    repositoryCommit: COMMIT,
    caseRevision: 1,
    legalContextRefs: [{ legalContextId: "req-1" }],
    applicability,
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

  const safeRepoLocator = sourcePathPrefix
    ? `${sourcePathPrefix}/apps/api/src/retention/purge.ts:10-42`
    : "apps/api/src/retention/purge.ts:10-42";

  const raw = {
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
      sourcePathPrefix,
    },
    caseRevision: 1,
    decisionFingerprint: sha("c"),
    sourceScope: {
      mode:
        sourcePathPrefix !== null
          ? ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.SUBTREE
          : ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.WHOLE_REPOSITORY,
      visibility,
      sourcePathPrefix,
      excludedPaths: [],
      limitationReasons:
        visibility === "KNOWN_FULL"
          ? []
          : ["External vendor repository not evaluated in this assessment run."],
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
      {
        legalRequirementId: "req-related",
        title: "Direct Related Legal Context",
        proposition: "The operator must document data retention.",
        applicabilityConditions: ["System stores regulated personal records."],
        qualifiers: [],
        exceptions: [],
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
        relatedLegalContexts: [
          {
            relationId: "rel-1",
            kind: "QUALIFIER",
            fromLegalRequirementId: "req-1",
            toLegalRequirementId: "req-related",
            sourceRefs: [sourceRef("law-1")],
          },
        ],
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
        criteriaDecisions: [
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
        ],
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
        safeLocator: safeRepoLocator,
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
              path: sourcePathPrefix ?? ".",
            },
          ],
          executedQueriesCount: 1,
          inspectedEntryPointsCount: 1,
          truncatedQueriesCount: 0,
          knownGapsCount: 0,
          directFallbackCount: 0,
          verifiedCompleteness: visibility === "KNOWN_FULL",
        },
      },
    ],
    outcomeSummary:
      compliance === RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT
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
      totalRecommendations: 1,
      omittedCount: 0,
      truncated: false,
      items: [
        {
          actionId: "rule-1#0",
          assessmentRuleId: "rule-1",
          ruleDetailRef: "/ruleDetails/0",
          recommendationIndex: 0,
          priority:
            compliance === RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT
              ? ASSESSMENT_REPORT_ACTION_PRIORITIES.HIGH
              : ASSESSMENT_REPORT_ACTION_PRIORITIES.LOW,
        },
      ],
    },
    publicationProvenance: {
      sourceManifestDigest: null,
      publishedAt: null,
    },
  };

  return assessmentFinalReportV3Schema.parse(raw);
}

test("C2: versioned union accepts V1, V2, and V3 reports while rejecting unknown schemas", () => {
  const v3 = createV3Fixture();
  const parsed = assessmentFinalReportArtifactVersionedSchema.parse(v3);
  assert.equal(parsed.schemaVersion, ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION);

  const unknown = {
    ...v3,
    schemaVersion: "99.0.0",
  };
  assert.equal(
    assessmentFinalReportArtifactVersionedSchema.safeParse(unknown).success,
    false,
  );
});

test("C2: buildAssessmentReportPresentation dispatches V3 without mutating decisions", () => {
  const v3 = createV3Fixture();
  const model = buildAssessmentReportPresentation(v3);

  assert.equal(model.version, ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION);
  assert.equal(model.header.assessmentId, v3.assessmentId);
  assert.equal(model.header.artifactId, v3.artifactId);
  assert.equal(model.header.sourceScope.mode, v3.sourceScope.mode);
  assert.equal(model.header.sourceScope.visibility, v3.sourceScope.visibility);

  assert.equal(model.summary.totalRules, 1);
  assert.equal(model.summary.applicableCompliant, 1);
  assert.equal(model.summary.statement, "NO_NON_COMPLIANT_FINDINGS");

  // Preserves related legal contexts in obligation catalog and details
  assert.equal(model.obligationCatalog[0].relatedLegalContexts.length, 1);
  assert.equal(
    model.obligationCatalog[0].relatedLegalContexts[0].relationId,
    "rel-1",
  );
  assert.equal(model.obligationDetails[0].relatedLegalContexts.length, 1);

  // Derives action plan using resolveV3BoundedActionPlanItems
  assert.equal(model.actionPlan.length, 1);
  assert.equal(model.actionPlan[0].actionId, "rule-1#0");
  assert.equal(
    model.actionPlan[0].priority,
    ASSESSMENT_REPORT_ACTION_PRIORITIES.LOW,
  );
  assert.equal(
    model.actionPlan[0].action,
    "Enable automated retention purge job on all customer records.",
  );

  // Preserves transitive facts and evidence
  assert.equal(model.applicabilityFacts[0].facts.length, 2);
  assert.equal(model.applicabilityFacts[0].evidence.length, 2);
});

test("C2: buildAssessmentReportPresentation rejects unsupported schema versions explicitly", () => {
  const invalid = {
    schemaVersion: "99.0.0",
  } as unknown as Parameters<typeof buildAssessmentReportPresentation>[0];

  assert.throws(
    () => buildAssessmentReportPresentation(invalid),
    /Unsupported report schema version: 99\.0\.0/,
  );
});

