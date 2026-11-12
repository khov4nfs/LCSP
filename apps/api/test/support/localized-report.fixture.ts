// Synthetic report data copied from the existing V2 contract fixture; no legal approval.

import {
  ASSESSMENT_REPORT_REFERENCE_ORIGINS,
  assessmentFinalReportV2Schema,
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

const decision = (
  applicability: (typeof RULE_DECISION_APPLICABILITIES)[keyof typeof RULE_DECISION_APPLICABILITIES],
) =>
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
        rationale: "The source-backed condition is not present.",
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
        rationale: "The source-backed condition applies.",
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

export function report(
  applicability: (typeof RULE_DECISION_APPLICABILITIES)[keyof typeof RULE_DECISION_APPLICABILITIES] = "APPLICABLE",
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
  return assessmentFinalReportV2Schema.parse({
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
        proposition: "A source-backed requirement.",
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
        concept: "Source-backed rule",
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
  });
}
