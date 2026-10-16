import {
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
  RULE_DECISION_CRITERION_OUTCOMES,
  RULE_DECISION_REFERENCE_TYPES,
  ruleDecisionSchema,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_ARTIFACT_KINDS,
  ASSESSMENT_DECISION_SCOPE,
  ASSESSMENT_EVIDENCE_TYPES,
  ASSESSMENT_FINAL_REPORT_V2_SCHEMA_VERSION,
  ASSESSMENT_RECORD_STATES,
} from "@lcsp/contracts/assessment-domain";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "@jest/globals";

import { buildAssessmentFinalReportV2 } from "./assessment-final-report-v2.builder.js";

const assessmentId = randomUUID();
const ruleSetVersionId = randomUUID();
const legalSourceVersionId = randomUUID();
const snapshotId = randomUUID();
const evidenceId = randomUUID();
const factId = randomUUID();
const decisionId = randomUUID();
const commit = "a".repeat(40);
const hash = `sha256:${"b".repeat(64)}`;

function buildInput(
  options: { notApplicable?: boolean; missingLocator?: boolean } = {},
) {
  const notApplicable = options.notApplicable ?? false;
  const decision = ruleDecisionSchema.parse({
    assessmentRuleId: "RULE-1",
    assessmentRuleVersion: "v1",
    scopeId: ASSESSMENT_DECISION_SCOPE,
    ruleSetVersionId,
    repositorySnapshotId: snapshotId,
    repositoryCommit: commit,
    caseRevision: 1,
    legalContextRefs: [{ legalContextId: "REQ-1" }],
    applicability: notApplicable
      ? RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE
      : RULE_DECISION_APPLICABILITIES.APPLICABLE,
    rationale: "Accepted rationale.",
    references: notApplicable
      ? [
          {
            type: RULE_DECISION_REFERENCE_TYPES.CONFIRMED_FACT,
            factId,
            caseRevision: 1,
          },
        ]
      : [
          {
            type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
            evidenceId,
          },
        ],
    criteria: notApplicable
      ? []
      : [
          {
            criterionId: "CRIT-1",
            outcome: RULE_DECISION_CRITERION_OUTCOMES.MET,
            rationale: "Accepted criterion rationale.",
            references: [
              {
                type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
                evidenceId,
              },
            ],
          },
        ],
    compliance: notApplicable
      ? null
      : RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT,
  });
  const sourceChunk = {
    id: "chunk-1",
    legalSourceVersionId,
    documentId: "DOC-1",
    locator: "article-1",
    contentSha256: hash,
    legalStatus: "ACTIVE",
  };
  const tx = {
    complianceRuleSetVersion: {
      findUnique: () => ({
        id: ruleSetVersionId,
        version: "rules-v1",
        ruleSetDigest: "c".repeat(64),
        legalSourceVersion: {
          id: legalSourceVersionId,
          version: "source-v1",
          integrityManifestRef: null,
        },
      }),
    },
    assessmentRule: {
      findMany: () => [
        {
          assessmentRuleId: "RULE-1",
          assessmentRuleVersion: "v1",
          concept: "Retention duty",
          legalIntent: "Preserve records.",
          applicabilityGuidance: "Applies to the assessed system.",
          criteria: [
            { criterionId: "CRIT-1", statement: "Records are retained." },
          ],
          contract: {
            sourceChunkIds: [sourceChunk.id],
            criteria: [
              { criterionId: "CRIT-1", statement: "Records are retained." },
            ],
          },
          legalRequirementLinks: [{ legalRequirementRowId: "req-row-1" }],
        },
      ],
    },
    legalRequirement: {
      findMany: () => [
        {
          id: "req-row-1",
          legalRequirementId: "REQ-1",
          title: "Retention requirement",
          proposition: "Records must be retained.",
          applicabilityConditions: ["The system stores records."],
          qualifiers: [],
          exceptions: [],
          nonRepositoryDuty: false,
          coverageState: "COVERED_BY_ASSESSMENT_RULES",
          provenance: [
            {
              legalSourceVersionId,
              documentId: sourceChunk.documentId,
              locator: sourceChunk.locator,
              contentSha256: sourceChunk.contentSha256,
            },
          ],
        },
      ],
    },
    legalDocumentChunk: { findMany: () => [sourceChunk] },
    assessmentCaseFact: {
      findMany: () =>
        notApplicable
          ? [
              {
                factId,
                caseRevision: 1,
                kind: "FACT",
                authority: "HUMAN_PROVIDED",
                statement: "The customer confirmed the system scope.",
                evidenceLinks: [{ evidenceId }],
              },
            ]
          : [],
    },
    assessmentEvidence: {
      findMany: () => [
        {
          evidenceId,
          type: ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE,
          state: ASSESSMENT_RECORD_STATES.ACCEPTED,
          repositoryCommit: commit,
          contentSha256: hash,
          payload: options.missingLocator
            ? {}
            : { path: "src/retention.ts", startLine: 4, endLine: 8 },
        },
      ],
    },
  } as never;
  return {
    tx,
    artifactId: randomUUID(),
    request: {
      kind: ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT,
      summary: "Assessment summary.",
      findings: [
        {
          assessmentRuleId: "RULE-1",
          summary: "Rule summary.",
          recommendations: [],
        },
      ],
    },
    snapshot: {
      caseRevision: 1,
      pins: {
        ruleSetVersionId,
        repositorySnapshotId: snapshotId,
        repositoryScanJobId: "scan-1",
        repositoryCommit: commit,
      },
      legalProvenance: {} as never,
      decisions: [{ decisionId, decisionRevision: 1, decision }],
      evidence: [],
      facts: [],
    },
  };
}

describe("buildAssessmentFinalReportV2", () => {
  it("assembles a canonical applicable report with exact provenance and counts", async () => {
    const report = await buildAssessmentFinalReportV2({
      assessmentId,
      ...buildInput(),
    });

    expect(report.schemaVersion).toBe(
      ASSESSMENT_FINAL_REPORT_V2_SCHEMA_VERSION,
    );
    expect(report.ruleDetails).toHaveLength(1);
    expect(report.ruleDetails[0].sourceRefs[0]).toMatchObject({
      legalSourceVersionId,
      documentId: "DOC-1",
      locator: "article-1",
      contentSha256: hash,
    });
    expect(report.outcomeSummary).toEqual({
      totalRules: 1,
      applicableCompliant: 1,
      applicableNonCompliant: 0,
      notApplicable: 0,
    });
    expect(report.evidenceIndex[0].safeLocator).toBe("src/retention.ts:4-8");
  });

  it("preserves NOT_APPLICABLE decision references and fact-linked evidence", async () => {
    const report = await buildAssessmentFinalReportV2({
      assessmentId,
      ...buildInput({ notApplicable: true }),
    });

    expect(report.ruleDetails[0].decision.compliance).toBeNull();
    expect(report.ruleDetails[0].decision.criteria).toEqual([]);
    expect(report.ruleDetails[0].decisionReferences).toHaveLength(1);
    expect(report.ruleDetails[0].factIds).toEqual([factId]);
    expect(report.ruleDetails[0].evidenceIds).toEqual([]);
    expect(report.factIndex[0].evidenceIds).toEqual([evidenceId]);
    expect(report.outcomeSummary.notApplicable).toBe(1);
  });

  it("rejects repository evidence without a canonical safe locator", async () => {
    await expect(
      buildAssessmentFinalReportV2({
        assessmentId,
        ...buildInput({ missingLocator: true }),
      }),
    ).rejects.toThrow("canonical locator");
  });
});
