import { randomUUID } from "node:crypto";
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
  ASSESSMENT_RECORD_STATES,
  SEARCH_COVERAGE_SCOPE_KINDS,
  computeRepositorySetDigest,
  type SubmitAssessmentFinalReportRequest,
} from "@lcsp/contracts/assessment-domain";
import { RepositoryScanJobStatus } from "@prisma/client";

import type { AssessmentFinalizationSnapshot } from "../application/services/assessment-completion-gate.service.js";

/**
 * Test fixture: a finalization snapshot, database stand-in and narrative request for an assessment pinned to two
 * repositories ("web" with no source prefix and "api" scoped to services/billing), each with its own repository
 * evidence and search coverage.
 */
export const id = (): string => randomUUID();
export const assessmentId = id();
export const ruleSetVersionId = id();
export const legalSourceVersionId = id();
export const decisionId = id();
export const factId = id();
export const webEvidenceId = id();
export const apiEvidenceId = id();
export const webCoverageId = id();
export const apiCoverageId = id();
export const hash = `sha256:${"b".repeat(64)}`;

export const web = {
  repositoryKey: "web",
  ordinal: 0,
  connectionId: "connection-web",
  repositoryId: "repository-web",
  repositoryFullName: "acme/web-app",
  repositorySnapshotId: id(),
  repositoryScanJobId: id(),
  repositoryCommit: "a".repeat(40),
  sourcePathPrefix: null as string | null,
};
export const api = {
  repositoryKey: "api",
  ordinal: 1,
  connectionId: "connection-api",
  repositoryId: "repository-api",
  repositoryFullName: "acme/billing-api",
  repositorySnapshotId: id(),
  repositoryScanJobId: id(),
  repositoryCommit: "c".repeat(40),
  sourcePathPrefix: "services/billing" as string | null,
};

export interface Options {
  webCoverage?: boolean;
  apiCoverage?: boolean;
  apiScanCompleted?: boolean;
  unboundEvidence?: boolean;
}

export function twoRepositoryReportEnvironment(options: Options = {}) {
  const {
    webCoverage = true,
    apiCoverage = true,
    apiScanCompleted = true,
    unboundEvidence = false,
  } = options;
  const decision = ruleDecisionSchema.parse({
    assessmentRuleId: "RULE-1",
    assessmentRuleVersion: "v1",
    scopeId: ASSESSMENT_DECISION_SCOPE,
    ruleSetVersionId,
    repositorySnapshotId: web.repositorySnapshotId,
    repositoryCommit: web.repositoryCommit,
    caseRevision: 1,
    legalContextRefs: [{ legalContextId: "REQ-1" }],
    applicability: RULE_DECISION_APPLICABILITIES.APPLICABLE,
    rationale: "Accepted decision rationale.",
    references: [
      {
        type: RULE_DECISION_REFERENCE_TYPES.CONFIRMED_FACT,
        factId,
        caseRevision: 1,
      },
      {
        type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
        evidenceId: webEvidenceId,
      },
      {
        type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
        evidenceId: apiEvidenceId,
      },
    ],
    criteria: [
      {
        criterionId: "CRIT-1",
        outcome: RULE_DECISION_CRITERION_OUTCOMES.MET,
        rationale: "Accepted criterion rationale.",
        references: [
          {
            type: RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,
            evidenceId: apiEvidenceId,
          },
        ],
      },
    ],
    compliance: RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT,
  });
  const sourceChunk = {
    id: "chunk-1",
    legalSourceVersionId,
    documentId: "DOC-1",
    locator: "article-1",
    contentSha256: hash,
    legalStatus: "ACTIVE",
  };
  const coverage = (
    id: string,
    repository: typeof web,
    key: string | null,
    root: string,
  ) => ({
    evidenceId: id,
    type: ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE,
    state: ASSESSMENT_RECORD_STATES.ACCEPTED,
    repositoryCommit: repository.repositoryCommit,
    repositoryKey: key,
    contentSha256: `sha256:${"d".repeat(64)}`,
    payload: {
      type: ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE,
      repositoryCommit: repository.repositoryCommit,
      scopes: [
        { kind: SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_DIRECTORY, path: root },
      ],
      queries: [
        { tool: "grep", query: "retention", resultCount: 3, truncated: false },
      ],
      inspectedEntryPoints: [],
      knownGaps: [],
      directSourceFallbacks: [],
    },
  });
  const evidenceRecords = [
    {
      evidenceId: webEvidenceId,
      type: ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE,
      state: ASSESSMENT_RECORD_STATES.ACCEPTED,
      repositoryCommit: web.repositoryCommit,
      repositoryKey: unboundEvidence ? null : "web",
      contentSha256: hash,
      payload: { path: "src/retention.ts", startLine: 10, endLine: 20 },
    },
    {
      evidenceId: apiEvidenceId,
      type: ASSESSMENT_EVIDENCE_TYPES.REPOSITORY_SOURCE,
      state: ASSESSMENT_RECORD_STATES.ACCEPTED,
      repositoryCommit: api.repositoryCommit,
      repositoryKey: "api",
      contentSha256: hash,
      payload: {
        path: "services/billing/charge.py",
        startLine: 3,
        endLine: 8,
      },
    },
    ...(webCoverage ? [coverage(webCoverageId, web, "web", ".")] : []),
    ...(apiCoverage
      ? [coverage(apiCoverageId, api, "api", "services/billing")]
      : []),
  ];
  const states = new Map([
    [
      web.repositorySnapshotId,
      { prefix: web.sourcePathPrefix, completed: true },
    ],
    [
      api.repositorySnapshotId,
      { prefix: api.sourcePathPrefix, completed: apiScanCompleted },
    ],
  ]);
  const jobs = new Map([
    [web.repositoryScanJobId, web.repositorySnapshotId],
    [api.repositoryScanJobId, api.repositorySnapshotId],
  ]);
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
            ],
          },
        }),
    },
    repositorySnapshot: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve({
          id: where.id,
          sourcePathPrefix: states.get(where.id)?.prefix ?? null,
        }),
    },
    repositoryScanJob: {
      findUnique: ({ where }: { where: { id: string } }) => {
        const snapshotId = jobs.get(where.id);
        const completed = snapshotId
          ? states.get(snapshotId)?.completed
          : false;
        return Promise.resolve({
          id: where.id,
          status: completed
            ? RepositoryScanJobStatus.COMPLETED
            : RepositoryScanJobStatus.FAILED,
          blockedReason: null,
        });
      },
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
        ]),
    },
    legalDocumentChunk: { findMany: () => Promise.resolve([sourceChunk]) },
    legalRequirementContextRelation: { findMany: () => Promise.resolve([]) },
    assessmentCaseFact: {
      findMany: () =>
        Promise.resolve([
          {
            factId,
            caseRevision: 1,
            kind: "FACT",
            authority: "EVIDENCE_CITED",
            statement: "Retention is configured in both services.",
            evidenceLinks: [
              { evidenceId: webEvidenceId },
              { evidenceId: apiEvidenceId },
            ],
          },
        ]),
    },
    assessmentEvidence: {
      findMany: (args?: { where?: { type?: string } }) =>
        Promise.resolve(
          args?.where?.type === ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE
            ? evidenceRecords.filter(
                (item) =>
                  item.type === ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE,
              )
            : evidenceRecords,
        ),
    },
  } as never;
  const repositories = [web, api];
  const snapshot: AssessmentFinalizationSnapshot = {
    caseRevision: 1,
    pins: {
      ruleSetVersionId,
      repositorySnapshotId: web.repositorySnapshotId,
      repositoryScanJobId: web.repositoryScanJobId,
      repositoryCommit: web.repositoryCommit,
      repositorySetDigest: computeRepositorySetDigest(repositories),
      repositories,
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
        recommendations: ["Configure retention purge cron job."],
      },
    ],
  };
  return { tx, snapshot, request };
}
