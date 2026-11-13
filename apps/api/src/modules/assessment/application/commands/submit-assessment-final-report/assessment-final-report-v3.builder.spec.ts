import { randomUUID } from "node:crypto";
import { describe, expect, it } from "@jest/globals";
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
  ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION,
  ASSESSMENT_RECORD_STATES,
  SEARCH_COVERAGE_SCOPE_KINDS,
  type SubmitAssessmentFinalReportRequest,
} from "@lcsp/contracts/assessment-domain";
import {
  ASSESSMENT_REPORT_ACTION_PRIORITIES,
  ASSESSMENT_REPORT_SOURCE_SCOPE_MODES,
  ASSESSMENT_REPORT_SOURCE_VISIBILITY_LIMITATION_REASONS,
  ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES,
  ASSESSMENT_REPORT_V3_REFERENCE_ORIGINS,
  assessmentFinalReportV3Schema,
  resolveV3BoundedActionPlanItems,
} from "@lcsp/contracts/assessment-report";
import { LEGAL_CONTEXT_RELATION_KINDS } from "@lcsp/contracts/compliance-rule-set";
import { RepositoryScanJobStatus } from "@prisma/client";

import { buildAssessmentFinalReportV3 } from "./assessment-final-report-v3.builder.js";
import type { AssessmentFinalizationSnapshot } from "../../services/assessment-completion-gate.service.js";

const assessmentId = randomUUID();
const ruleSetVersionId = randomUUID();
const legalSourceVersionId = randomUUID();
const snapshotId = randomUUID();
const scanJobId = randomUUID();
const evidenceId = randomUUID();
const coverageEvidenceId = randomUUID();
const factId = randomUUID();
const decisionId = randomUUID();
const commit = "a".repeat(40);
const hash = `sha256:${"b".repeat(64)}`;

interface BuildTestOptions {
  sourcePathPrefix?: string | null;
  notApplicable?: boolean;
  nonCompliant?: boolean;
  withSearchCoverage?: boolean;
  scanJobCompleted?: boolean;
  scanJobBlocked?: boolean;
  truncatedQueries?: boolean;
  knownGaps?: boolean;
  hasRelatedContext?: boolean;
}

function buildTestEnvironment(options: BuildTestOptions = {}) {
  const {
    sourcePathPrefix = null,
    notApplicable = false,
    nonCompliant = false,
    withSearchCoverage = false,
    scanJobCompleted = true,
    scanJobBlocked = false,
    truncatedQueries = false,
    knownGaps = false,
    hasRelatedContext = true,
  } = options;

  const compliance = notApplicable
    ? null
    : nonCompliant
      ? RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT
      : RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT;

  const criterionOutcome = notApplicable
    ? null
    : nonCompliant
      ? RULE_DECISION_CRITERION_OUTCOMES.NOT_MET
      : RULE_DECISION_CRITERION_OUTCOMES.MET;

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
    rationale: "Accepted decision rationale.",
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
            outcome: criterionOutcome!,
            rationale: "Accepted criterion rationale.",
            references: [
              {
                type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
                evidenceId,
              },
            ],
          },
        ],
    compliance,
  });

  const sourceChunk = {
    id: "chunk-1",
    legalSourceVersionId,
    documentId: "DOC-1",
    locator: "article-1",
    contentSha256: hash,
    legalStatus: "ACTIVE",
  };

  const relatedSourceChunk = {
    id: "chunk-rel-1",
    legalSourceVersionId,
    documentId: "DOC-REL",
    locator: "section-2",
    contentSha256: `sha256:${"c".repeat(64)}`,
    legalStatus: "ACTIVE",
  };

  const evidenceRecords: Array<{
    evidenceId: string;
    type: string;
    state: string;
    repositoryCommit: string;
    contentSha256: string;
    payload: Record<string, unknown>;
  }> = [
    {
      evidenceId,
      type: ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE,
      state: ASSESSMENT_RECORD_STATES.ACCEPTED,
      repositoryCommit: commit,
      contentSha256: hash,
      payload: {
        path: sourcePathPrefix
          ? `${sourcePathPrefix}/retention.ts`
          : "src/retention.ts",
        startLine: 10,
        endLine: 20,
      },
    },
  ];

  if (withSearchCoverage) {
    const coverageRoot = sourcePathPrefix ?? ".";
    evidenceRecords.push({
      evidenceId: coverageEvidenceId,
      type: ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE,
      state: ASSESSMENT_RECORD_STATES.ACCEPTED,
      repositoryCommit: commit,
      contentSha256: `sha256:${"d".repeat(64)}`,
      payload: {
        type: ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE,
        repositoryCommit: commit,
        scopes: [
          {
            kind: SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_DIRECTORY,
            path: coverageRoot,
          },
        ],
        queries: [
          {
            tool: "semgrep",
            query: "find retention policies",
            resultCount: 5,
            truncated: truncatedQueries,
          },
        ],
        inspectedEntryPoints: [
          sourcePathPrefix ? `${sourcePathPrefix}/main.ts` : "src/main.ts",
        ],
        knownGaps: knownGaps ? ["Unanalyzed dynamic eval"] : [],
        directSourceFallbacks: [],
      },
    });
  }

  const tx = {
    complianceRuleSetVersion: {
      findUnique: () =>
        Promise.resolve({
          id: ruleSetVersionId,
          version: "rules-v1",
          ruleSetDigest: "e".repeat(64),
          legalSourceVersion: {
            id: legalSourceVersionId,
            version: "source-v1",
            integrityManifestRef: null,
            documents: [
              { documentId: "DOC-1", title: "Law on Data Protection" },
              { documentId: "DOC-REL", title: "Related Definitions Act" },
            ],
          },
        }),
    },
    repositorySnapshot: {
      findUnique: () =>
        Promise.resolve({
          id: snapshotId,
          sourcePathPrefix,
        }),
    },
    repositoryScanJob: {
      findUnique: () =>
        Promise.resolve({
          id: scanJobId,
          status: scanJobCompleted
            ? RepositoryScanJobStatus.COMPLETED
            : RepositoryScanJobStatus.FAILED,
          blockedReason: scanJobBlocked ? "SCANNER_TIMEOUT" : null,
        }),
    },
    assessmentRule: {
      findMany: () =>
        Promise.resolve([
          {
            assessmentRuleId: "RULE-1",
            assessmentRuleVersion: "v1",
            concept: "Retention schedule control",
            legalIntent: "Preserve records within statutory limits.",
            applicabilityGuidance: "Applies when customer data is processed.",
            criteria: [
              {
                criterionId: "CRIT-1",
                statement: "Retention period configured.",
              },
            ],
            contract: {
              sourceChunkIds: [sourceChunk.id],
              criteria: [
                {
                  criterionId: "CRIT-1",
                  statement: "Retention period configured.",
                },
              ],
            },
            legalRequirementLinks: [{ legalRequirementRowId: "req-row-1" }],
          },
        ]),
    },
    legalRequirement: {
      findMany: () =>
        Promise.resolve([
          {
            id: "req-row-1",
            legalRequirementId: "REQ-1",
            title: "Data retention mandate",
            proposition: "Personal data must be purged after purpose ends.",
            applicabilityConditions: ["Personal data processed."],
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
          ...(hasRelatedContext
            ? [
                {
                  id: "req-row-2",
                  legalRequirementId: "REQ-REL-2",
                  title: "Definition of personal data",
                  proposition: "Personal data includes identifiers.",
                  applicabilityConditions: [],
                  qualifiers: [],
                  exceptions: [],
                  nonRepositoryDuty: false,
                  coverageState: "COVERED_BY_ASSESSMENT_RULES",
                  provenance: [
                    {
                      legalSourceVersionId,
                      documentId: relatedSourceChunk.documentId,
                      locator: relatedSourceChunk.locator,
                      contentSha256: relatedSourceChunk.contentSha256,
                    },
                  ],
                },
              ]
            : []),
        ]),
    },
    legalDocumentChunk: {
      findMany: () => Promise.resolve([sourceChunk, relatedSourceChunk]),
    },
    legalRequirementContextRelation: {
      findMany: () =>
        Promise.resolve(
          hasRelatedContext
            ? [
                {
                  id: "rel-1",
                  relationId: "REL-DEF-1",
                  kind: LEGAL_CONTEXT_RELATION_KINDS.DEFINITION,
                  fromRuleId: "req-row-1",
                  toRuleId: "req-row-2",
                  toChunkId: "chunk-rel-1",
                  ordinal: 1,
                },
              ]
            : [],
        ),
    },
    assessmentCaseFact: {
      findMany: () =>
        Promise.resolve(
          notApplicable
            ? [
                {
                  factId,
                  caseRevision: 1,
                  kind: "FACT",
                  authority: "HUMAN_PROVIDED",
                  statement: "Customer confirmed no personal data processed.",
                  evidenceLinks: [{ evidenceId }],
                },
              ]
            : [],
        ),
    },
    assessmentEvidence: {
      findMany: (args?: { where?: { type?: string } }) => {
        if (args?.where?.type === ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE) {
          return Promise.resolve(
            evidenceRecords.filter(
              (e) => e.type === ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE,
            ),
          );
        }
        return Promise.resolve(evidenceRecords);
      },
    },
  } as never;

  const snapshot: AssessmentFinalizationSnapshot = {
    caseRevision: 1,
    pins: {
      ruleSetVersionId,
      repositorySnapshotId: snapshotId,
      repositoryScanJobId: scanJobId,
      repositoryCommit: commit,
    },
    decisions: [{ decisionId, decisionRevision: 1, decision }],
    evidence: [],
    facts: [],
    legalProvenance: {} as never,
  };

  const request: SubmitAssessmentFinalReportRequest = {
    kind: ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT,
    summary: "System compliance final report summary.",
    findings: [
      {
        assessmentRuleId: "RULE-1",
        summary: "Rule 1 narrative assessment summary.",
        recommendations: [
          "Configure retention purge cron job.",
          "Document data lifecycle.",
        ],
      },
    ],
  };

  return { tx, snapshot, request };
}

describe("buildAssessmentFinalReportV3", () => {
  it("P1-01: binds pins.sourcePathPrefix and WHOLE_REPOSITORY scope when repositorySnapshot has null sourcePathPrefix", async () => {
    const { tx, snapshot, request } = buildTestEnvironment({
      sourcePathPrefix: null,
    });

    const report = await buildAssessmentFinalReportV3({
      tx,
      assessmentId,
      artifactId: randomUUID(),
      request,
      snapshot,
    });

    expect(report.schemaVersion).toBe(
      ASSESSMENT_FINAL_REPORT_V3_SCHEMA_VERSION,
    );
    expect(report.pins.sourcePathPrefix).toBeNull();
    expect(report.sourceScope.mode).toBe(
      ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.WHOLE_REPOSITORY,
    );
    expect(report.sourceScope.sourcePathPrefix).toBeNull();
    expect(report.sourceScope.visibility).toBe(
      ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_LIMITED,
    );
    expect(report.sourceScope.limitationReasons).toContain(
      ASSESSMENT_REPORT_SOURCE_VISIBILITY_LIMITATION_REASONS.PARTIAL_COVERAGE_RECORDED,
    );
    expect(assessmentFinalReportV3Schema.parse(report)).toEqual(report);
  });

  it("P1-01: binds pins.sourcePathPrefix and SUBTREE scope when repositorySnapshot has a defined sourcePathPrefix", async () => {
    const { tx, snapshot, request } = buildTestEnvironment({
      sourcePathPrefix: "services/core",
    });

    const report = await buildAssessmentFinalReportV3({
      tx,
      assessmentId,
      artifactId: randomUUID(),
      request,
      snapshot,
    });

    expect(report.pins.sourcePathPrefix).toBe("services/core");
    expect(report.sourceScope.mode).toBe(
      ASSESSMENT_REPORT_SOURCE_SCOPE_MODES.SUBTREE,
    );
    expect(report.sourceScope.sourcePathPrefix).toBe("services/core");
    expect(assessmentFinalReportV3Schema.parse(report)).toEqual(report);
  });

  it("P1-02: defines criteria statements on ruleDetails[].criteria only and keeps criteriaDecisions lean without statement duplication", async () => {
    const { tx, snapshot, request } = buildTestEnvironment();

    const report = await buildAssessmentFinalReportV3({
      tx,
      assessmentId,
      artifactId: randomUUID(),
      request,
      snapshot,
    });

    const rule = report.ruleDetails[0];
    expect(rule.criteria).toEqual([
      { criterionId: "CRIT-1", statement: "Retention period configured." },
    ]);
    expect(rule.criteriaDecisions).toEqual([
      {
        criterionId: "CRIT-1",
        outcome: RULE_DECISION_CRITERION_OUTCOMES.MET,
        rationale: "Accepted criterion rationale.",
        references: [
          {
            origin: ASSESSMENT_REPORT_V3_REFERENCE_ORIGINS.criterion,
            reference: {
              type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
              evidenceId,
            },
          },
        ],
      },
    ]);
    expect(
      (rule.criteriaDecisions[0] as Record<string, unknown>).statement,
    ).toBeUndefined();
  });

  it("P1-03: derives boundedActionPlan items with deterministic rule pointers and priorities without mutable action summaries", async () => {
    const { tx, snapshot, request } = buildTestEnvironment({
      nonCompliant: true,
    });

    const report = await buildAssessmentFinalReportV3({
      tx,
      assessmentId,
      artifactId: randomUUID(),
      request,
      snapshot,
    });

    expect(report.boundedActionPlan.totalRecommendations).toBe(2);
    expect(report.boundedActionPlan.omittedCount).toBe(0);
    expect(report.boundedActionPlan.truncated).toBe(false);
    expect(report.boundedActionPlan.items).toHaveLength(2);

    expect(report.boundedActionPlan.items[0]).toEqual({
      actionId: "RULE-1#0",
      assessmentRuleId: "RULE-1",
      ruleDetailRef: "/ruleDetails/0",
      recommendationIndex: 0,
      priority: ASSESSMENT_REPORT_ACTION_PRIORITIES.HIGH,
    });
    expect(report.boundedActionPlan.items[1]).toEqual({
      actionId: "RULE-1#1",
      assessmentRuleId: "RULE-1",
      ruleDetailRef: "/ruleDetails/0",
      recommendationIndex: 1,
      priority: ASSESSMENT_REPORT_ACTION_PRIORITIES.HIGH,
    });

    const resolved = resolveV3BoundedActionPlanItems(report);
    expect(resolved).toHaveLength(2);
    expect(resolved[0].recommendation).toBe(
      "Configure retention purge cron job.",
    );
    expect(resolved[1].recommendation).toBe("Document data lifecycle.");
  });

  it("P1-04: populates relatedLegalContexts from LegalRequirementContextRelation with pinned source refs", async () => {
    const { tx, snapshot, request } = buildTestEnvironment({
      hasRelatedContext: true,
    });

    const report = await buildAssessmentFinalReportV3({
      tx,
      assessmentId,
      artifactId: randomUUID(),
      request,
      snapshot,
    });

    const rule = report.ruleDetails[0];
    expect(rule.relatedLegalContexts).toHaveLength(1);
    expect(rule.relatedLegalContexts[0]).toEqual({
      relationId: "REL-DEF-1",
      kind: LEGAL_CONTEXT_RELATION_KINDS.DEFINITION,
      fromLegalRequirementId: "REQ-1",
      toLegalRequirementId: "REQ-REL-2",
      sourceRefs: [
        {
          legalSourceVersionId,
          legalSourceVersion: "source-v1",
          documentId: "DOC-REL",
          documentTitle: "Related Definitions Act",
          locator: "section-2",
          contentSha256: `sha256:${"c".repeat(64)}`,
        },
      ],
    });
  });

  it("P1-05 & P1-06: promotes visibility to KNOWN_FULL when verified platform scan is completed with zero truncations and gaps", async () => {
    const { tx, snapshot, request } = buildTestEnvironment({
      withSearchCoverage: true,
      scanJobCompleted: true,
      scanJobBlocked: false,
      truncatedQueries: false,
      knownGaps: false,
    });

    const report = await buildAssessmentFinalReportV3({
      tx,
      assessmentId,
      artifactId: randomUUID(),
      request,
      snapshot,
    });

    expect(report.sourceScope.visibility).toBe(
      ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_FULL,
    );
    expect(report.sourceScope.limitationReasons).toEqual([]);
    expect(report.sourceScope.searchCoverageEvidenceIds).toEqual([
      coverageEvidenceId,
    ]);

    const coverageEvidence = report.evidenceIndex.find(
      (e) => e.evidenceId === coverageEvidenceId,
    );
    expect(coverageEvidence?.searchCoverage?.verifiedCompleteness).toBe(true);
    expect(coverageEvidence?.searchCoverage?.executedQueriesCount).toBe(1);
    expect(coverageEvidence?.searchCoverage?.truncatedQueriesCount).toBe(0);
    expect(coverageEvidence?.searchCoverage?.knownGapsCount).toBe(0);
  });

  it("P1-05 & P1-06: demotes visibility to KNOWN_LIMITED when scan job is incomplete or blocked", async () => {
    const { tx, snapshot, request } = buildTestEnvironment({
      withSearchCoverage: true,
      scanJobCompleted: false,
    });

    const report = await buildAssessmentFinalReportV3({
      tx,
      assessmentId,
      artifactId: randomUUID(),
      request,
      snapshot,
    });

    expect(report.sourceScope.visibility).toBe(
      ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_LIMITED,
    );
    expect(report.sourceScope.limitationReasons).toContain(
      ASSESSMENT_REPORT_SOURCE_VISIBILITY_LIMITATION_REASONS.PARTIAL_COVERAGE_RECORDED,
    );

    const coverageEvidence = report.evidenceIndex.find(
      (e) => e.evidenceId === coverageEvidenceId,
    );
    expect(coverageEvidence?.searchCoverage?.verifiedCompleteness).toBe(false);
  });

  it("P1-05 & P1-06: demotes visibility to KNOWN_LIMITED and records SEARCH_TRUNCATED when queries were truncated", async () => {
    const { tx, snapshot, request } = buildTestEnvironment({
      withSearchCoverage: true,
      scanJobCompleted: true,
      truncatedQueries: true,
    });

    const report = await buildAssessmentFinalReportV3({
      tx,
      assessmentId,
      artifactId: randomUUID(),
      request,
      snapshot,
    });

    expect(report.sourceScope.visibility).toBe(
      ASSESSMENT_REPORT_SOURCE_VISIBILITY_STATES.KNOWN_LIMITED,
    );
    expect(report.sourceScope.limitationReasons).toContain(
      ASSESSMENT_REPORT_SOURCE_VISIBILITY_LIMITATION_REASONS.SEARCH_TRUNCATED,
    );
    expect(report.sourceScope.limitationReasons).toContain(
      ASSESSMENT_REPORT_SOURCE_VISIBILITY_LIMITATION_REASONS.PARTIAL_COVERAGE_RECORDED,
    );

    const coverageEvidence = report.evidenceIndex.find(
      (e) => e.evidenceId === coverageEvidenceId,
    );
    expect(coverageEvidence?.searchCoverage?.verifiedCompleteness).toBe(false);
    expect(coverageEvidence?.searchCoverage?.truncatedQueriesCount).toBe(1);
  });
});
